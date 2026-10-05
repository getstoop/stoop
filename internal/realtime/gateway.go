// Package realtime is the WebSocket gateway: it holds one authenticated
// connection per client, subscribes it to its user's bus topics, and
// pushes protobuf-encoded ServerEvent frames. It never talks to
// the database or other modules directly — only through its ports.
package realtime

import (
	"context"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"golang.org/x/time/rate"
	"google.golang.org/protobuf/proto"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/events"
)

const (
	pingInterval = 30 * time.Second
	pingTimeout  = 10 * time.Second
	writeTimeout = 10 * time.Second
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
	if err != nil {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	if !opensSocket(id.Credential.Kind) {
		http.Error(w, "this credential can't open a realtime connection", http.StatusForbidden)
		return
	}
	userID, sessionID := id.UserID, id.Credential.ID

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

	g.connectPresence(ctx, userID, spaceIDs)
	defer g.disconnectPresence(userID)

	// A read error means the peer is gone.
	go func() {
		defer cancel()
		g.readClientEvents(ctx, conn, userID, connID, sub)
	}()

	if err := g.send(ctx, conn, g.ready(userID, spaceIDs)); err != nil {
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
		case <-pings.C:
			// The session is checked again with every ping, so one that
			// expired, or a revocation the bus never carried (the CLI, a
			// publish that beat the subscription), ends the socket within
			// a ping.
			if fresh, err := g.verifier.VerifyRequest(ctx, r.Header); err != nil || fresh.Credential.ID != sessionID {
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
			if !g.deliver(ctx, conn, userID, sessionID, sub, ev) {
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

// connectPresence counts a new connection. The first one announces the
// person online to their spaces. Do not disturb is read again on every
// connect, which also rebuilds an end timer a restart lost.
func (g *Gateway) connectPresence(ctx context.Context, userID string, spaceIDs []string) {
	first := g.presence.connect(userID, spaceIDs)
	changed := false
	if setting, ok := g.lookupDoNotDisturb(ctx, userID); ok {
		changed = g.applyDoNotDisturb(userID, setting)
	}
	if first || changed {
		g.publishPresence(userID, g.presence.spacesOf(userID), true)
	}
}

// disconnectPresence counts a closed connection; the last one announces the
// person offline.
func (g *Gateway) disconnectPresence(userID string) {
	if spaces := g.presence.disconnect(userID); spaces != nil {
		g.publishPresence(userID, spaces, false)
	}
}

// readClientEvents handles what the client sends (typing, voice state)
// until a read fails. Pong control frames are read here too.
func (g *Gateway) readClientEvents(ctx context.Context, conn *websocket.Conn, userID string, connID uint64, sub *events.Subscription) {
	lastTyping := map[string]time.Time{}
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
		if typing := event.GetTyping(); typing != nil {
			g.relayTyping(ctx, userID, sub, typing, lastTyping)
		}
		if voiceState := event.GetVoiceState(); voiceState != nil {
			g.handleVoiceState(ctx, userID, connID, sub, voiceState)
		}
	}
}

func (g *Gateway) ready(userID string, spaceIDs []string) *realtimev1.ServerEvent {
	return events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_Ready{
			Ready: &realtimev1.Ready{
				UserId: userID, SpaceIds: spaceIDs,
				OnlineUserIds:     g.presence.onlineIn(spaceIDs),
				Presences:         g.presence.presencesIn(spaceIDs),
				VoiceParticipants: g.voice.participantsIn(spaceIDs),
			},
		},
	})
}

// deliver applies one bus event to the connection and forwards it; false
// when the socket is done.
func (g *Gateway) deliver(ctx context.Context, conn *websocket.Conn, userID, sessionID string, sub *events.Subscription, ev *realtimev1.ServerEvent) bool {
	joinedSpace := g.applyControlEvent(userID, sub, ev)
	// A revocation is told only to the socket opened with that session.
	if revoked := ev.GetCredentialRevoked(); revoked != nil && revoked.CredentialId != sessionID {
		return true
	}
	if err := g.send(ctx, conn, ev); err != nil {
		return false
	}
	// Ready only covered the spaces held at connect time; the new space's
	// presence and voice state follow its SpaceJoined.
	if joinedSpace != "" {
		if err := g.sendSpaceSnapshot(ctx, conn, joinedSpace); err != nil {
			return false
		}
	}
	// The session this socket was opened with is gone: the client has been
	// told, and must not come back with it.
	if ev.GetCredentialRevoked() != nil {
		_ = conn.Close(StatusCredentialRevoked, "credential revoked")
		return false
	}
	return true
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
		g.channelDeleted(payload.ChannelDeleted.ChannelId)
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
func (g *Gateway) sendSpaceSnapshot(ctx context.Context, conn *websocket.Conn, spaceID string) error {
	spaceIDs := []string{spaceID}
	for _, online := range g.presence.presencesIn(spaceIDs) {
		if err := g.send(ctx, conn, presenceChanged(online.UserId, true, online.Dnd)); err != nil {
			return err
		}
	}
	for _, participant := range g.voice.participantsIn(spaceIDs) {
		if err := g.send(ctx, conn, voiceStateChanged(participant, true)); err != nil {
			return err
		}
	}
	return nil
}

func (g *Gateway) publishPresence(userID string, spaceIDs []string, online bool) {
	dnd := online && g.presence.dndOf(userID)
	for _, spaceID := range spaceIDs {
		g.bus.Publish(events.SpaceTopic(spaceID), presenceChanged(userID, online, dnd))
	}
}

func presenceChanged(userID string, online, dnd bool) *realtimev1.ServerEvent {
	return events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_PresenceChanged{
			PresenceChanged: &realtimev1.PresenceChanged{UserId: userID, Online: online, Dnd: dnd},
		},
	})
}

// relayTyping rebroadcasts a typing hint — to the space, if the connection
// is actually subscribed to it, or (with no space) to the direct message's
// other participants, if the sender is one — unless it relayed for this
// channel a moment ago.
func (g *Gateway) relayTyping(ctx context.Context, userID string, sub *events.Subscription, t *realtimev1.Typing, last map[string]time.Time) {
	if t.ChannelId == "" {
		return
	}
	now := time.Now()
	if now.Sub(last[t.ChannelId]) < typingInterval {
		return
	}

	var topics []string
	if t.SpaceId != "" {
		if !sub.Has(events.SpaceTopic(t.SpaceId)) {
			return
		}
		topics = []string{events.SpaceTopic(t.SpaceId)}
	} else {
		ids, err := g.channels.DMParticipants(ctx, t.ChannelId)
		if err != nil {
			g.log.Error("resolve dm participants", "err", err)
			return
		}
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
	last[t.ChannelId] = now
	ev := events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_UserTyping{
			UserTyping: &realtimev1.UserTyping{SpaceId: t.SpaceId, ChannelId: t.ChannelId, UserId: userID},
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
