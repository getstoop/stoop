// Package realtime is the WebSocket gateway: it holds one authenticated
// connection per client, subscribes it to the bus topics the user is entitled
// to, and pushes protobuf-encoded ServerEvent frames. It never talks to the
// database or other modules directly — only through its ports.
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
// headers (cookie or bearer token); implemented by the auth module, wired in
// internal/app.
type SessionVerifier interface {
	VerifyRequest(ctx context.Context, h http.Header) (userID string, err error)
}

// MembershipLister reports which spaces a user belongs to; implemented by
// the chat module, wired in internal/app.
type MembershipLister interface {
	ListSpaceIDs(ctx context.Context, userID string) ([]string, error)
}

type Gateway struct {
	bus            events.Bus
	verifier       SessionVerifier
	members        MembershipLister
	channels       ChannelLookup
	originPatterns []string
	log            *slog.Logger
	presence       *presence
	voice          *voiceState
	connSeq        atomic.Uint64
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
	}
}

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	userID, err := g.verifier.VerifyRequest(ctx, r.Header)
	if err != nil {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}

	spaceIDs, err := g.members.ListSpaceIDs(ctx, userID)
	if err != nil {
		g.log.Error("list memberships", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

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
	// last disconnect announces "offline".
	if g.presence.connect(userID, spaceIDs) {
		g.publishPresence(userID, spaceIDs, true)
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
				g.relayTyping(ctx, userID, sub, t, lastTyping)
			}
			if vs := ev.GetVoiceState(); vs != nil {
				g.handleVoiceState(ctx, userID, connID, sub, vs)
			}
			if st := ev.GetSetStatus(); st != nil {
				if g.presence.setStatus(userID, st.Status) {
					g.publishPresence(userID, spaceIDs, true)
				}
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

	g.log.Info("ws connected", "user_id", userID)
	defer g.log.Info("ws disconnected", "user_id", userID)

	pings := time.NewTicker(pingInterval)
	defer pings.Stop()

	for {
		select {
		case <-ctx.Done():
			_ = conn.Close(websocket.StatusNormalClosure, "")
			return
		case <-pings.C:
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
			// on this same connection.
			if joined := ev.GetSpaceJoined(); joined != nil {
				sub.Add("space:" + joined.Space.Id)
				g.presence.addSpace(userID, joined.Space.Id)
				g.publishPresence(userID, []string{joined.Space.Id}, true)
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
			if err := g.send(ctx, conn, ev); err != nil {
				return
			}
		}
	}
}

func (g *Gateway) publishPresence(userID string, spaceIDs []string, online bool) {
	var status realtimev1.PresenceStatus
	if online {
		status = g.presence.statusOf(userID)
	}
	for _, s := range spaceIDs {
		g.bus.Publish("space:"+s, events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_PresenceChanged{
				PresenceChanged: &realtimev1.PresenceChanged{UserId: userID, Online: online, Status: status},
			},
		}))
	}
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
	last[t.ChannelId] = now

	var topics []string
	if t.SpaceId != "" {
		if !sub.Has("space:" + t.SpaceId) {
			return
		}
		topics = []string{"space:" + t.SpaceId}
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
