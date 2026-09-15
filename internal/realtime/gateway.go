// Package realtime is the WebSocket gateway: it holds one authenticated
// connection per client, subscribes it to the bus topics its credential
// covers, and pushes protobuf-encoded ServerEvent frames. It never talks to
// the database or other modules directly — only through its ports.
package realtime

import (
	"context"
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"google.golang.org/protobuf/proto"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/events"
)

const (
	pingInterval = 30 * time.Second
	pingTimeout  = 10 * time.Second
	writeTimeout = 10 * time.Second
	// typingInterval is the least time between relayed typing events from
	// one connection for one channel; faster sends are dropped.
	typingInterval = 2 * time.Second
)

// SessionVerifier authenticates the WebSocket upgrade from the request
// headers (cookie or bearer token): who is calling, with what credential.
// Implemented by the auth module, wired in internal/app.
type SessionVerifier interface {
	VerifyRequest(ctx context.Context, h http.Header) (authctx.Identity, error)
}

// MembershipLister reports which spaces a user belongs to; implemented by
// the chat module, wired in internal/app.
type MembershipLister interface {
	ListSpaceIDs(ctx context.Context, userID string) ([]string, error)
}

// DoNotDisturbLookup reports whether a person is on do not disturb and when
// it ends; implemented by the auth module, wired in internal/app.
type DoNotDisturbLookup interface {
	DoNotDisturb(ctx context.Context, userID string) (on bool, until *time.Time, err error)
}

type Gateway struct {
	bus            events.Bus
	verifier       SessionVerifier
	members        MembershipLister
	channels       ChannelLookup
	dnd            DoNotDisturbLookup
	originPatterns []string
	log            *slog.Logger
	presence       *presence
	voice          *voiceState
	connSeq        atomic.Uint64
	pingInterval   time.Duration
}

func NewGateway(bus events.Bus, verifier SessionVerifier, members MembershipLister, channels ChannelLookup, originPatterns []string, log *slog.Logger) *Gateway {
	return &Gateway{
		bus:            bus,
		verifier:       verifier,
		members:        members,
		channels:       channels,
		originPatterns: originPatterns,
		log:            log,
		presence:       newPresence(),
		voice:          newVoiceState(),
		pingInterval:   pingInterval,
	}
}

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
	userID, cred := id.UserID, id.Credential

	memberOf, err := g.members.ListSpaceIDs(ctx, userID)
	if err != nil {
		g.log.Error("list memberships", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	// Only the spaces the credential may read are subscribed, snapshotted
	// and counted for presence.
	spaceIDs := coveredSpaces(cred, memberOf)

	topics := make([]string, 0, len(spaceIDs)+1)
	topics = append(topics, "user:"+userID)
	for _, id := range spaceIDs {
		topics = append(topics, "space:"+id)
	}
	sub := g.bus.Subscribe(topics...)
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
	defer g.leaveVoice(userID, connID, "")

	// Presence: first connection announces "online" to the user's spaces,
	// last disconnect announces "offline". Do not disturb is read again on
	// every connect, which also rebuilds an end timer a restart lost.
	first := g.presence.connect(userID, spaceIDs)
	changed := false
	if s, ok := g.lookupDoNotDisturb(ctx, userID); ok {
		changed = g.applyDoNotDisturb(userID, s)
	}
	if first || changed {
		g.publishPresence(userID, g.presence.spacesOf(userID), true)
	}
	defer func() {
		if g.presence.disconnect(userID) {
			g.publishPresence(userID, spaceIDs, false)
		}
	}()

	// Read loop: client events (typing, voice state) and pong control
	// frames. A read error means the peer is gone.
	go func() {
		defer cancel()
		lastTyping := map[string]time.Time{}
		for {
			_, data, err := conn.Read(ctx)
			if err != nil {
				return
			}
			ev := &realtimev1.ClientEvent{}
			if err := proto.Unmarshal(data, ev); err != nil {
				continue
			}
			if t := ev.GetTyping(); t != nil {
				g.relayTyping(ctx, userID, cred, sub, t, lastTyping)
			}
			if vs := ev.GetVoiceState(); vs != nil {
				g.handleVoiceState(ctx, userID, cred, connID, sub, vs)
			}
		}
	}()

	if err := g.send(ctx, conn, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_Ready{
			Ready: &realtimev1.Ready{
				UserId: userID, SpaceIds: spaceIDs,
				OnlineUserIds:     g.presence.onlineIn(spaceIDs),
				Presences:         g.presence.presencesIn(spaceIDs),
				VoiceParticipants: g.voice.participantsIn(spaceIDs),
			},
		},
	})); err != nil {
		return
	}

	g.log.Info("ws connected", "user_id", userID, "credential", cred.Kind)
	defer g.log.Info("ws disconnected", "user_id", userID)

	pings := time.NewTicker(g.pingInterval)
	defer pings.Stop()

	for {
		select {
		case <-ctx.Done():
			_ = conn.Close(websocket.StatusNormalClosure, "")
			return
		case <-pings.C:
			// The credential is checked again with every ping, so a
			// token that expired, a setting that turned tokens off, or a
			// revocation the bus never carried (the CLI, a publish that
			// beat the subscription) ends the socket within a ping.
			if fresh, err := g.verifier.VerifyRequest(ctx, r.Header); err != nil || fresh.Credential.ID != cred.ID {
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
			// Joining a space while connected: start receiving its events
			// on this same connection, if the credential reaches it.
			joinedSpace := ""
			if joined := ev.GetSpaceJoined(); joined != nil && coversSpace(cred, authctx.MessagesRead, joined.Space.Id) {
				joinedSpace = joined.Space.Id
				sub.Add("space:" + joinedSpace)
				g.presence.addSpace(userID, joinedSpace)
				g.publishPresence(userID, []string{joinedSpace}, true)
			}
			// Kicked, left, or the space is gone: stop receiving its events.
			if removed := ev.GetMemberRemoved(); removed != nil && removed.UserId == userID {
				g.leaveVoice(userID, 0, removed.SpaceId)
				sub.Remove("space:" + removed.SpaceId)
				g.presence.removeSpace(userID, removed.SpaceId)
			}
			if deleted := ev.GetSpaceDeleted(); deleted != nil {
				g.leaveVoice(userID, 0, deleted.SpaceId)
				sub.Remove("space:" + deleted.SpaceId)
				g.presence.removeSpace(userID, deleted.SpaceId)
			}
			if deleted := ev.GetChannelDeleted(); deleted != nil {
				g.channelDeleted(deleted.ChannelId)
			}
			// Set from any of the person's devices. Every connection hears
			// it; only the first to apply it finds a change to announce.
			if dnd := ev.GetDoNotDisturbChanged(); dnd != nil && dnd.UserId == userID {
				if g.applyDoNotDisturb(userID, dndFrom(dnd)) {
					g.publishPresence(userID, g.presence.spacesOf(userID), true)
				}
			}
			if !admits(cred, ev) {
				continue
			}
			if err := g.send(ctx, conn, ev); err != nil {
				return
			}
			// Ready only covered the spaces held at connect time; the new
			// space's presence and voice state follow its SpaceJoined.
			if joinedSpace != "" {
				if err := g.sendSpaceSnapshot(ctx, conn, joinedSpace); err != nil {
					return
				}
			}
			// The credential this socket was opened with is gone: the
			// client has been told, and must not come back with it.
			if ev.GetCredentialRevoked() != nil {
				_ = conn.Close(StatusCredentialRevoked, "credential revoked")
				return
			}
		}
	}
}

// sendSpaceSnapshot tells one connection who is online and in voice in a
// space it just joined, as the change events it would have seen had it
// been subscribed all along.
func (g *Gateway) sendSpaceSnapshot(ctx context.Context, conn *websocket.Conn, spaceID string) error {
	ids := []string{spaceID}
	for _, p := range g.presence.presencesIn(ids) {
		err := g.send(ctx, conn, events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_PresenceChanged{
				PresenceChanged: &realtimev1.PresenceChanged{UserId: p.UserId, Online: true, Dnd: p.Dnd},
			},
		}))
		if err != nil {
			return err
		}
	}
	for _, p := range g.voice.participantsIn(ids) {
		err := g.send(ctx, conn, events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_VoiceStateChanged{
				VoiceStateChanged: &realtimev1.VoiceStateChanged{Participant: p, Joined: true},
			},
		}))
		if err != nil {
			return err
		}
	}
	return nil
}

func (g *Gateway) publishPresence(userID string, spaceIDs []string, online bool) {
	dnd := online && g.presence.dndOf(userID)
	for _, s := range spaceIDs {
		g.bus.Publish("space:"+s, events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_PresenceChanged{
				PresenceChanged: &realtimev1.PresenceChanged{UserId: userID, Online: online, Dnd: dnd},
			},
		}))
	}
}

// relayTyping rebroadcasts a typing hint — to the space, if the connection
// is actually subscribed to it, or (with no space) to the direct message's
// other participants, if the sender is one — unless it relayed for this
// channel a moment ago. Typing is a promise to post, so the credential
// must cover posting there.
func (g *Gateway) relayTyping(ctx context.Context, userID string, cred authctx.Credential, sub *events.Subscription, t *realtimev1.Typing, last map[string]time.Time) {
	if t.ChannelId == "" {
		return
	}
	now := time.Now()
	if now.Sub(last[t.ChannelId]) < typingInterval {
		return
	}
	last[t.ChannelId] = now

	var topics []string
	if t.SpaceId != "" {
		if !sub.Has("space:"+t.SpaceId) || !coversSpace(cred, authctx.MessagesPost, t.SpaceId) {
			return
		}
		topics = []string{"space:" + t.SpaceId}
	} else {
		if !coversOwn(cred, authctx.DMsPost) {
			return
		}
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
				topics = append(topics, "user:"+id)
			}
		}
		if !mine {
			return
		}
	}
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
