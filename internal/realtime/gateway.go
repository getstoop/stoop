// Package realtime is the WebSocket gateway: it holds one authenticated
// connection per client, subscribes it to its user's bus topics, and
// pushes protobuf-encoded ServerEvent frames. It never talks to
// the database or other modules directly — only through its ports.
package realtime

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"golang.org/x/time/rate"
	"google.golang.org/protobuf/proto"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/events"
)

const (
	pingInterval = 30 * time.Second
	pingTimeout  = 10 * time.Second
	writeTimeout = 10 * time.Second
	// lookupTimeout bounds the port call a client event makes on the main
	// loop, so a slow database delays the connection's other work by at
	// most this; the event is then ignored.
	lookupTimeout = 5 * time.Second
	// typingInterval is the least time between relayed typing events from
	// one connection for one channel; faster sends are dropped.
	typingInterval = 2 * time.Second
	// The web app sends a typing frame per channel every few seconds and a
	// voice report per join, leave or toggle, so a person stays far below
	// these; frames over them are dropped before they are decoded.
	clientFrameRate  = 5 // per second, sustained
	clientFrameBurst = 20
)

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	id, err := g.verifier.VerifyRequest(ctx, r.Header)
	if errors.Is(err, authctx.ErrNoSession) {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	if err != nil {
		g.log.Error("verify credential", "err", err)
		http.Error(w, "the server can't check your sign-in right now", http.StatusServiceUnavailable)
		return
	}
	if !opensSocket(id.Credential.Kind) {
		http.Error(w, "this credential can't open a realtime connection", http.StatusForbidden)
		return
	}
	userID, sessionID := id.UserID, id.Credential.ID
	// A mobile app says so when it connects. Only the person's own presence
	// mark rests on it, so it is taken as given, like a voice report.
	mobile := r.URL.Query().Get("client") == "mobile"

	spaceIDs, err := g.members.ListSpaceIDs(ctx, userID)
	if err != nil {
		g.log.Error("list memberships", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	sub := g.subscribe(userID, spaceIDs)
	defer sub.Close()

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: g.originPatterns,
	})
	if err != nil {
		g.log.Debug("ws accept", "err", err)
		return
	}
	defer func() { _ = conn.Close(websocket.StatusInternalError, "") }()

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	// connID identifies this connection as the owner of any voice state it
	// reports, so another tab's disconnect doesn't drop it.
	connID := g.connSeq.Add(1)
	defer func() { g.publishLeft(userID, g.voice.clearOwnedBy(userID, connID)) }()

	g.connectPresence(ctx, userID, spaceIDs, mobile)
	// A socket closed because its session ended takes the person offline
	// at once; any other close waits out the grace period.
	revoked := false
	defer func() { g.disconnectPresence(userID, mobile, revoked) }()

	// The reader only decodes; this goroutine applies what it hands over,
	// so nothing changes this connection's state after the deferred
	// cleanup. A read error means the peer is gone.
	clientEvents := make(chan *realtimev1.ClientEvent, clientFrameBurst)
	go func() {
		defer cancel()
		readClientEvents(ctx, conn, clientEvents)
	}()
	typing := newTypingMemory()

	if err := g.send(ctx, conn, g.ready(ctx, userID, spaceIDs)); err != nil {
		return
	}

	g.log.Info("ws connected", "user_id", userID)
	defer g.log.Info("ws disconnected", "user_id", userID)

	pings := time.NewTicker(g.pingInterval)
	defer pings.Stop()

	for {
		select {
		case <-ctx.Done():
			_ = conn.Close(websocket.StatusNormalClosure, "")
			return
		case event := <-clientEvents:
			g.handleClientEvent(ctx, userID, connID, sub, event, typing)
		case <-pings.C:
			// The session is checked again with every ping, so one that
			// expired, or a revocation the bus never carried (the CLI, a
			// publish that beat the subscription), ends the socket within
			// a ping.
			// A check that failed says nothing about the session, but an
			// unverified socket must not stay subscribed: close it as
			// retryable, and the client reconnects rather than signing out.
			fresh, verifyErr := g.verifier.VerifyRequest(ctx, r.Header)
			if verifyErr != nil && !errors.Is(verifyErr, authctx.ErrNoSession) {
				g.log.Warn("re-verify credential", "err", verifyErr)
				_ = conn.Close(websocket.StatusTryAgainLater, "cannot verify session")
				return
			}
			if verifyErr != nil || fresh.Credential.ID != sessionID {
				revoked = true
				_ = conn.Close(StatusCredentialRevoked, "credential revoked")
				return
			}
			pingCtx, done := context.WithTimeout(ctx, pingTimeout)
			err := conn.Ping(pingCtx)
			done()
			if err != nil {
				return
			}
		case ev, ok := <-sub.Events():
			if !ok {
				// Dropped by the bus for falling behind; the client
				// reconnects and recovers via ListMessages.
				_ = conn.Close(websocket.StatusTryAgainLater, "event overflow")
				return
			}
			open, ended := g.deliver(ctx, conn, userID, sessionID, sub, ev)
			if !open {
				revoked = ended
				return
			}
		}
	}
}

// subscribe opens the bus subscription for a connection: the person's own
// topic and each space they belong to.
func (g *Gateway) subscribe(userID string, spaceIDs []string) *events.Subscription {
	topics := make([]string, 0, len(spaceIDs)+1)
	topics = append(topics, events.UserTopic(userID))
	for _, spaceID := range spaceIDs {
		topics = append(topics, events.SpaceTopic(spaceID))
	}
	return g.bus.Subscribe(topics...)
}

// connectPresence counts a new connection and announces the person online
// in each space they are newly counted in: every space for the first
// connection, and a space joined since for a later one (its SpaceJoined
// then finds it counted). Do not disturb is read again on every connect,
// which also rebuilds an end timer a restart lost; a change to it, or a
// computer joining a person only on mobile, is announced everywhere. Both
// read what is counted after the lookup, so a removal another connection
// applied meanwhile is not announced.
func (g *Gateway) connectPresence(ctx context.Context, userID string, spaceIDs []string, mobile bool) {
	added, mobileChanged := g.presence.connect(userID, spaceIDs, mobile)
	setting, ok := g.lookupDoNotDisturb(ctx, userID)
	if dndChanged := ok && g.applyDoNotDisturb(userID, setting); dndChanged || mobileChanged {
		g.publishPresence(userID, g.presence.spacesOf(userID), true)
		return
	}
	g.publishPresence(userID, g.presence.countedIn(userID, added), true)
}

// disconnectPresence counts a closed connection. The last one announces
// the person offline after the grace period, or at once when its session
// ended; a grace timer announces through presence.settled.
func (g *Gateway) disconnectPresence(userID string, mobile, sessionEnded bool) {
	offline, toMobile := g.presence.disconnect(userID, mobile, sessionEnded)
	if offline != nil {
		g.publishPresence(userID, offline, false)
	}
	if toMobile {
		g.publishPresence(userID, g.presence.spacesOf(userID), true)
	}
}

// readClientEvents decodes what the client sends and hands it to the
// connection's main loop until a read fails. Pong control frames are read
// here too, so it never waits on the main loop: one stuck in a ping would
// wait on it in turn. A frame that finds the hand-over full is dropped,
// like one over the rate.
func readClientEvents(ctx context.Context, conn *websocket.Conn, out chan<- *realtimev1.ClientEvent) {
	frames := rate.NewLimiter(clientFrameRate, clientFrameBurst)
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		if !frames.Allow() {
			continue
		}
		event := &realtimev1.ClientEvent{}
		if err := proto.Unmarshal(data, event); err != nil {
			continue
		}
		select {
		case out <- event:
		default:
		}
	}
}

// handleClientEvent applies one client event: a typing hint or a voice
// state report.
func (g *Gateway) handleClientEvent(ctx context.Context, userID string, connID uint64, sub *events.Subscription, event *realtimev1.ClientEvent, memory *typingMemory) {
	ctx, cancel := context.WithTimeout(ctx, g.lookupTimeout)
	defer cancel()
	if typing := event.GetTyping(); typing != nil {
		g.relayTyping(ctx, userID, sub, typing, memory)
	}
	if voiceState := event.GetVoiceState(); voiceState != nil {
		g.handleVoiceState(ctx, userID, connID, sub, voiceState)
	}
}

func (g *Gateway) ready(ctx context.Context, userID string, spaceIDs []string) *realtimev1.ServerEvent {
	return events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_Ready{
			Ready: &realtimev1.Ready{
				UserId: userID, SpaceIds: spaceIDs,
				Presences:         g.presence.presencesIn(spaceIDs),
				VoiceParticipants: g.voiceRoster(ctx, userID, spaceIDs),
			},
		},
	})
}

// deliver applies one bus event to the connection and forwards it. open
// is false when the socket is done, and sessionEnded says it closed
// because the session it was opened with is gone.
func (g *Gateway) deliver(ctx context.Context, conn *websocket.Conn, userID, sessionID string, sub *events.Subscription, ev *realtimev1.ServerEvent) (open, sessionEnded bool) {
	joinedSpace := g.applyControlEvent(userID, sub, ev)
	// A revocation is told only to the socket opened with that session.
	if revoked := ev.GetCredentialRevoked(); revoked != nil && revoked.CredentialId != sessionID {
		return true, false
	}
	if err := g.send(ctx, conn, ev); err != nil {
		return false, false
	}
	// Ready only covered the spaces held at connect time; the new space's
	// presence and voice state follow its SpaceJoined.
	if joinedSpace != "" {
		if err := g.sendSpaceSnapshot(ctx, conn, userID, joinedSpace); err != nil {
			return false, false
		}
	}
	// Added to a private voice channel: who is already in it follows.
	if created := ev.GetChannelCreated(); created.GetPrivate() {
		for _, participant := range g.voice.participantsInChannel(created.Id) {
			if err := g.send(ctx, conn, voiceStateChanged(participant, true)); err != nil {
				return false, false
			}
		}
	}
	// The session this socket was opened with is gone: the client has been
	// told, and must not come back with it.
	if ev.GetCredentialRevoked() != nil {
		_ = conn.Close(StatusCredentialRevoked, "credential revoked")
		return false, true
	}
	return true, false
}

// applyControlEvent keeps this connection's subscription, presence and voice
// state in step with an event before it is forwarded. It returns the space
// joined, if any, whose snapshot follows the event.
func (g *Gateway) applyControlEvent(userID string, sub *events.Subscription, ev *realtimev1.ServerEvent) (joinedSpace string) {
	switch payload := ev.Payload.(type) {
	case *realtimev1.ServerEvent_SpaceJoined:
		// Joined while connected: its events arrive on this connection.
		joinedSpace = payload.SpaceJoined.Space.Id
		sub.Add(events.SpaceTopic(joinedSpace))
		// Each of the person's connections hears the join; the first to
		// record it announces them.
		if g.presence.addSpace(userID, joinedSpace) {
			g.publishPresence(userID, []string{joinedSpace}, true)
		}
	case *realtimev1.ServerEvent_MemberRemoved:
		if payload.MemberRemoved.UserId == userID {
			g.dropSpace(userID, sub, payload.MemberRemoved.SpaceId)
		}
	case *realtimev1.ServerEvent_SpaceDeleted:
		g.dropSpace(userID, sub, payload.SpaceDeleted.SpaceId)
	case *realtimev1.ServerEvent_ChannelDeleted:
		g.channelDeleted(userID, payload.ChannelDeleted.ChannelId)
	case *realtimev1.ServerEvent_DoNotDisturbChanged:
		// Set from any of the person's devices. Every connection hears it;
		// only the first to apply it finds a change to announce.
		if payload.DoNotDisturbChanged.UserId == userID && g.applyDoNotDisturb(userID, dndFrom(payload.DoNotDisturbChanged)) {
			g.publishPresence(userID, g.presence.spacesOf(userID), true)
		}
	}
	return joinedSpace
}

// dropSpace stops a connection hearing a space it was removed from or that
// is gone, and takes the person out of its voice channel.
func (g *Gateway) dropSpace(userID string, sub *events.Subscription, spaceID string) {
	g.publishLeft(userID, g.voice.clearInSpace(userID, spaceID))
	sub.Remove(events.SpaceTopic(spaceID))
	g.presence.removeSpace(userID, spaceID)
}

// sendSpaceSnapshot tells one connection who is online and in voice in a
// space it just joined, as the change events it would have seen had it
// been subscribed all along.
func (g *Gateway) sendSpaceSnapshot(ctx context.Context, conn *websocket.Conn, userID, spaceID string) error {
	spaceIDs := []string{spaceID}
	for _, online := range g.presence.presencesIn(spaceIDs) {
		if err := g.send(ctx, conn, presenceChanged(online.UserId, true, online.Dnd, online.Mobile)); err != nil {
			return err
		}
	}
	for _, participant := range g.voiceRoster(ctx, userID, spaceIDs) {
		if err := g.send(ctx, conn, voiceStateChanged(participant, true)); err != nil {
			return err
		}
	}
	return nil
}

func (g *Gateway) publishPresence(userID string, spaceIDs []string, online bool) {
	dnd := online && g.presence.dndOf(userID)
	mobile := online && g.presence.mobileOf(userID)
	for _, spaceID := range spaceIDs {
		g.bus.Publish(events.SpaceTopic(spaceID), presenceChanged(userID, online, dnd, mobile))
	}
}

func presenceChanged(userID string, online, dnd, mobile bool) *realtimev1.ServerEvent {
	return events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_PresenceChanged{
			PresenceChanged: &realtimev1.PresenceChanged{UserId: userID, Online: online, Dnd: dnd, Mobile: mobile},
		},
	})
}

// typingMemory is what one connection remembers between typing hints.
type typingMemory struct {
	// last is when a hint was last relayed for a channel.
	last map[string]time.Time
	// public holds channels known to go to their space. A channel is
	// private from the day it is made or never, so asking once is enough.
	public map[string]bool
}

// maxRememberedPublic bounds what a connection remembers; past it the
// memory starts over, which costs one lookup per channel again.
const maxRememberedPublic = 512

func (memory *typingMemory) rememberPublic(channelID string) {
	if len(memory.public) >= maxRememberedPublic {
		memory.public = map[string]bool{}
	}
	memory.public[channelID] = true
}

func newTypingMemory() *typingMemory {
	return &typingMemory{last: map[string]time.Time{}, public: map[string]bool{}}
}

// relayTyping rebroadcasts a typing hint — to the space for a public
// channel, if the connection is actually subscribed to it, or to the
// other people in a direct message or private channel, if the sender is
// one — unless it relayed for this channel a moment ago. Which of the two
// a channel is comes from chat, never from the space id the client sent.
func (g *Gateway) relayTyping(ctx context.Context, userID string, sub *events.Subscription, hint *realtimev1.Typing, memory *typingMemory) {
	if hint.ChannelId == "" {
		return
	}
	last := memory.last
	now := time.Now()
	if now.Sub(last[hint.ChannelId]) < typingInterval {
		return
	}

	var topics []string
	var ids []string
	listed := false
	if !memory.public[hint.ChannelId] {
		var err error
		if ids, listed, err = g.channels.ChannelPeople(ctx, hint.ChannelId); err != nil {
			// Not knowing is not the same as public: relay nothing.
			g.log.Error("resolve channel people", "err", err)
			return
		}
	}
	if !listed {
		if hint.SpaceId == "" || !sub.Has(events.SpaceTopic(hint.SpaceId)) {
			return
		}
		memory.rememberPublic(hint.ChannelId)
		topics = []string{events.SpaceTopic(hint.SpaceId)}
	} else {
		mine := false
		for _, id := range ids {
			if id == userID {
				mine = true
			} else {
				topics = append(topics, events.UserTopic(id))
			}
		}
		if !mine {
			return
		}
	}
	last[hint.ChannelId] = now
	ev := events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_UserTyping{
			UserTyping: &realtimev1.UserTyping{SpaceId: hint.SpaceId, ChannelId: hint.ChannelId, UserId: userID},
		},
	})
	for _, topic := range topics {
		g.bus.Publish(topic, ev)
	}
}

func (g *Gateway) send(ctx context.Context, conn *websocket.Conn, ev *realtimev1.ServerEvent) error {
	data, err := proto.Marshal(ev)
	if err != nil {
		return err
	}
	writeCtx, done := context.WithTimeout(ctx, writeTimeout)
	defer done()
	return conn.Write(writeCtx, websocket.MessageBinary, data)
}
