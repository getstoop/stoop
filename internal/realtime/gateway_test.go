package realtime_test

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"google.golang.org/protobuf/proto"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/realtime"
)

// Bearer token == user id; memberships are fixed per user.
type fakeVerifier struct{}

func (fakeVerifier) VerifyRequest(_ context.Context, h http.Header) (string, error) {
	return strings.TrimPrefix(h.Get("Authorization"), "Bearer "), nil
}

type fakeMembers map[string][]string

func (m fakeMembers) ListSpaceIDs(_ context.Context, userID string) ([]string, error) {
	return m[userID], nil
}

// voice channel id → space id; anything else is unknown or text.
type fakeVoiceChannels map[string]string

func (c fakeVoiceChannels) VoiceChannelSpace(_ context.Context, channelID string) (string, error) {
	return c[channelID], nil
}

func (fakeVoiceChannels) DMParticipants(context.Context, string) ([]string, error) {
	return nil, nil
}

// client reads frames on a goroutine into a channel so that waiting with
// a timeout never cancels a Read (which would close the socket).
type client struct {
	conn   *websocket.Conn
	t      *testing.T
	events chan *realtimev1.ServerEvent
}

func dial(t *testing.T, srv *httptest.Server, user string) *client {
	t.Helper()
	h := http.Header{"Authorization": {"Bearer " + user}}
	conn, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", &websocket.DialOptions{HTTPHeader: h})
	if err != nil {
		t.Fatal(err)
	}
	c := &client{conn: conn, t: t, events: make(chan *realtimev1.ServerEvent, 64)}
	go func() {
		defer close(c.events)
		for {
			_, data, err := conn.Read(context.Background())
			if err != nil {
				return
			}
			ev := &realtimev1.ServerEvent{}
			if err := proto.Unmarshal(data, ev); err == nil {
				c.events <- ev
			}
		}
	}()
	return c
}

// next returns the next event or nil after timeout.
func (c *client) next(timeout time.Duration) *realtimev1.ServerEvent {
	select {
	case ev := <-c.events:
		return ev
	case <-time.After(timeout):
		return nil
	}
}

// waitFor drains events until pred matches or two seconds pass.
func (c *client) waitFor(pred func(*realtimev1.ServerEvent) bool) *realtimev1.ServerEvent {
	deadline := time.After(2 * time.Second)
	for {
		select {
		case ev, ok := <-c.events:
			if !ok {
				return nil
			}
			if pred(ev) {
				return ev
			}
		case <-deadline:
			return nil
		}
	}
}

func (c *client) send(ev *realtimev1.ClientEvent) {
	data, _ := proto.Marshal(ev)
	if err := c.conn.Write(context.Background(), websocket.MessageBinary, data); err != nil {
		c.t.Fatal(err)
	}
}

func TestPresenceAndTyping(t *testing.T) {
	bus := events.NewInProcBus()
	gw := realtime.NewGateway(bus, fakeVerifier{}, fakeMembers{
		"alice": {"s1"}, "bob": {"s1", "s2"}, "carol": {"s2"},
	}, fakeVoiceChannels{}, []string{"*"}, slog.Default())
	mux := http.NewServeMux()
	mux.Handle("/ws", gw)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	alice := dial(t, srv, "alice")
	ready := alice.next(time.Second).GetReady()
	if ready == nil || len(ready.OnlineUserIds) != 1 || ready.OnlineUserIds[0] != "alice" {
		t.Fatalf("alice ready = %+v", ready)
	}

	// bob connects: alice (shares s1) hears he's online; his Ready lists both.
	bob := dial(t, srv, "bob")
	bready := bob.next(time.Second).GetReady()
	if bready == nil || len(bready.OnlineUserIds) != 2 {
		t.Fatalf("bob ready = %+v", bready)
	}
	if ev := alice.waitFor(func(e *realtimev1.ServerEvent) bool {
		p := e.GetPresenceChanged()
		return p != nil && p.UserId == "bob" && p.Online
	}); ev == nil {
		t.Fatal("alice never heard bob come online")
	}

	// carol only shares s2 with bob: alice must not hear about her.
	carol := dial(t, srv, "carol")
	cready := carol.next(time.Second).GetReady()
	if cready == nil || len(cready.OnlineUserIds) != 2 { // bob + carol
		t.Fatalf("carol ready = %+v", cready)
	}
	if ev := alice.next(300 * time.Millisecond); ev != nil {
		t.Fatalf("alice received an unrelated event: %v", ev)
	}

	// @here port: who's online among a set.
	online, _ := gw.OnlineUserIDs(context.Background(), []string{"alice", "bob", "carol", "dave"})
	if len(online) != 3 {
		t.Errorf("OnlineUserIDs = %v", online)
	}

	// Typing: bob types in s1 → alice sees it; a second one within the
	// interval is dropped; typing in a space he isn't subscribed to is ignored.
	bob.send(&realtimev1.ClientEvent{Payload: &realtimev1.ClientEvent_Typing{Typing: &realtimev1.Typing{SpaceId: "s1", ChannelId: "c1"}}})
	if ev := alice.waitFor(func(e *realtimev1.ServerEvent) bool { return e.GetUserTyping() != nil }); ev == nil || ev.GetUserTyping().UserId != "bob" {
		t.Fatal("alice never saw bob typing")
	}
	bob.send(&realtimev1.ClientEvent{Payload: &realtimev1.ClientEvent_Typing{Typing: &realtimev1.Typing{SpaceId: "s1", ChannelId: "c1"}}})
	bob.send(&realtimev1.ClientEvent{Payload: &realtimev1.ClientEvent_Typing{Typing: &realtimev1.Typing{SpaceId: "s9", ChannelId: "c9"}}})
	if ev := alice.next(300 * time.Millisecond); ev != nil {
		t.Fatalf("rate limit / subscription check failed: %v", ev)
	}

	// bob has two connections; closing one keeps him online, closing both
	// announces offline exactly once.
	bob2 := dial(t, srv, "bob")
	bob2.next(time.Second)
	_ = bob2.conn.Close(websocket.StatusNormalClosure, "")
	if ev := alice.next(300 * time.Millisecond); ev != nil && ev.GetPresenceChanged() != nil {
		t.Fatalf("offline announced while bob still had a connection: %v", ev)
	}
	_ = bob.conn.Close(websocket.StatusNormalClosure, "")
	if ev := alice.waitFor(func(e *realtimev1.ServerEvent) bool {
		p := e.GetPresenceChanged()
		return p != nil && p.UserId == "bob" && !p.Online
	}); ev == nil {
		t.Fatal("alice never heard bob go offline")
	}
	_ = alice.conn.Close(websocket.StatusNormalClosure, "")
	_ = carol.conn.Close(websocket.StatusNormalClosure, "")
}

func voiceEvent(channelID string, muted bool) *realtimev1.ClientEvent {
	return &realtimev1.ClientEvent{Payload: &realtimev1.ClientEvent_VoiceState{
		VoiceState: &realtimev1.VoiceState{ChannelId: channelID, Muted: muted},
	}}
}

func TestVoiceState(t *testing.T) {
	bus := events.NewInProcBus()
	gw := realtime.NewGateway(bus, fakeVerifier{}, fakeMembers{
		"alice": {"s1"}, "bob": {"s1", "s2"}, "carol": {"s2"},
	}, fakeVoiceChannels{"v1": "s1", "v1b": "s1", "v2": "s2"}, []string{"*"}, slog.Default())
	srv := httptest.NewServer(gw)
	defer srv.Close()

	voiceChange := func(user string, joined bool) func(*realtimev1.ServerEvent) bool {
		return func(e *realtimev1.ServerEvent) bool {
			v := e.GetVoiceStateChanged()
			return v != nil && v.Participant.UserId == user && v.Joined == joined
		}
	}

	alice := dial(t, srv, "alice")
	alice.next(time.Second)
	bob := dial(t, srv, "bob")
	bob.next(time.Second)
	alice.waitFor(func(e *realtimev1.ServerEvent) bool { return e.GetPresenceChanged() != nil })

	// bob joins v1: alice sees him arrive, with his mute state.
	bob.send(voiceEvent("v1", true))
	ev := alice.waitFor(voiceChange("bob", true))
	if ev == nil {
		t.Fatal("alice never saw bob join voice")
	}
	if p := ev.GetVoiceStateChanged().Participant; p.SpaceId != "s1" || p.ChannelId != "v1" || !p.Muted {
		t.Errorf("participant = %+v", p)
	}

	// Late joiner's Ready carries the snapshot.
	alice2 := dial(t, srv, "alice")
	ready := alice2.next(time.Second).GetReady()
	if ready == nil || len(ready.VoiceParticipants) != 1 || ready.VoiceParticipants[0].UserId != "bob" {
		t.Fatalf("ready voice snapshot = %+v", ready)
	}
	_ = alice2.conn.Close(websocket.StatusNormalClosure, "")

	// Unmute is an upsert; a text/unknown channel and a channel in a space
	// bob isn't in are ignored.
	bob.send(voiceEvent("v1", false))
	if ev := alice.waitFor(voiceChange("bob", true)); ev == nil || ev.GetVoiceStateChanged().Participant.Muted {
		t.Fatalf("unmute not relayed: %v", ev)
	}
	bob.send(voiceEvent("text", false))
	if ev := alice.next(300 * time.Millisecond); ev != nil {
		t.Fatalf("unexpected event for a non-voice channel: %v", ev)
	}
	carol := dial(t, srv, "carol")
	carol.next(time.Second)
	carol.send(voiceEvent("v1", false))
	if ev := alice.next(300 * time.Millisecond); ev != nil {
		t.Fatalf("carol is not in s1 but was placed in v1: %v", ev)
	}

	// Moving channels announces leave then join.
	bob.send(voiceEvent("v1b", false))
	if ev := alice.waitFor(voiceChange("bob", false)); ev == nil || ev.GetVoiceStateChanged().Participant.ChannelId != "v1" {
		t.Fatalf("move: leave not announced: %v", ev)
	}
	if ev := alice.waitFor(voiceChange("bob", true)); ev == nil || ev.GetVoiceStateChanged().Participant.ChannelId != "v1b" {
		t.Fatalf("move: join not announced: %v", ev)
	}

	// Another of bob's connections closing must not drop his voice state;
	// deleting the channel does.
	bob2 := dial(t, srv, "bob")
	bob2.next(time.Second)
	_ = bob2.conn.Close(websocket.StatusNormalClosure, "")
	if ev := alice.next(300 * time.Millisecond); ev != nil && ev.GetVoiceStateChanged() != nil {
		t.Fatalf("voice dropped by a sibling connection: %v", ev)
	}
	bus.Publish("space:s1", events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelDeleted{ChannelDeleted: &realtimev1.ChannelDeleted{SpaceId: "s1", ChannelId: "v1b"}},
	}))
	if ev := alice.waitFor(voiceChange("bob", false)); ev == nil {
		t.Fatal("channel deletion did not drop bob from voice")
	}

	// Explicit leave, then disconnect while in voice.
	bob.send(voiceEvent("v2", false))
	if ev := carol.waitFor(voiceChange("bob", true)); ev == nil {
		t.Fatal("carol never saw bob join v2")
	}
	bob.send(voiceEvent("", false))
	if ev := carol.waitFor(voiceChange("bob", false)); ev == nil {
		t.Fatal("explicit leave not relayed")
	}
	bob.send(voiceEvent("v2", false))
	carol.waitFor(voiceChange("bob", true))
	_ = bob.conn.Close(websocket.StatusNormalClosure, "")
	if ev := carol.waitFor(voiceChange("bob", false)); ev == nil {
		t.Fatal("disconnect did not drop bob from voice")
	}

	// Kicked from the space while in voice.
	carol.send(voiceEvent("v2", false))
	carol.waitFor(voiceChange("carol", true))
	bus.Publish("space:s2", events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MemberRemoved{MemberRemoved: &realtimev1.MemberRemoved{SpaceId: "s2", UserId: "carol", Kicked: true}},
	}))
	// carol's connection no longer hears s2, so check via a fresh Ready.
	carol2 := dial(t, srv, "carol")
	if ready := carol2.next(time.Second).GetReady(); ready == nil || len(ready.VoiceParticipants) != 0 {
		t.Fatalf("carol still in voice after kick: %+v", ready)
	}
	_ = carol2.conn.Close(websocket.StatusNormalClosure, "")
	_ = carol.conn.Close(websocket.StatusNormalClosure, "")
	_ = alice.conn.Close(websocket.StatusNormalClosure, "")
}

func TestStatus(t *testing.T) {
	bus := events.NewInProcBus()
	gw := realtime.NewGateway(bus, fakeVerifier{}, fakeMembers{
		"alice": {"s1"}, "bob": {"s1"},
	}, fakeVoiceChannels{}, []string{"*"}, slog.Default())
	mux := http.NewServeMux()
	mux.Handle("/ws", gw)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	alice := dial(t, srv, "alice")
	if r := alice.next(time.Second).GetReady(); r == nil || len(r.Presences) != 1 ||
		r.Presences[0].Status != realtimev1.PresenceStatus_PRESENCE_STATUS_ONLINE {
		t.Fatalf("alice ready presences = %+v", r)
	}
	// Alice goes DND: bob's Ready shows it, and a change reaches him live.
	alice.send(&realtimev1.ClientEvent{Payload: &realtimev1.ClientEvent_SetStatus{
		SetStatus: &realtimev1.SetStatus{Status: realtimev1.PresenceStatus_PRESENCE_STATUS_DND},
	}})
	if ev := alice.waitFor(func(ev *realtimev1.ServerEvent) bool {
		p := ev.GetPresenceChanged()
		return p != nil && p.UserId == "alice" && p.Status == realtimev1.PresenceStatus_PRESENCE_STATUS_DND
	}); ev == nil {
		t.Fatal("alice never saw her own status change")
	}
	bob := dial(t, srv, "bob")
	r := bob.next(time.Second).GetReady()
	var got realtimev1.PresenceStatus
	for _, p := range r.GetPresences() {
		if p.UserId == "alice" {
			got = p.Status
		}
	}
	if got != realtimev1.PresenceStatus_PRESENCE_STATUS_DND {
		t.Errorf("bob's Ready: alice status %v, want DND", got)
	}
	alice.send(&realtimev1.ClientEvent{Payload: &realtimev1.ClientEvent_SetStatus{
		SetStatus: &realtimev1.SetStatus{Status: realtimev1.PresenceStatus_PRESENCE_STATUS_AWAY},
	}})
	if ev := bob.waitFor(func(ev *realtimev1.ServerEvent) bool {
		p := ev.GetPresenceChanged()
		return p != nil && p.UserId == "alice" && p.Online && p.Status == realtimev1.PresenceStatus_PRESENCE_STATUS_AWAY
	}); ev == nil {
		t.Error("bob never heard alice go away")
	}
	// The same status again is not re-announced.
	alice.send(&realtimev1.ClientEvent{Payload: &realtimev1.ClientEvent_SetStatus{
		SetStatus: &realtimev1.SetStatus{Status: realtimev1.PresenceStatus_PRESENCE_STATUS_AWAY},
	}})
	if ev := bob.next(300 * time.Millisecond); ev != nil && ev.GetPresenceChanged() != nil {
		t.Errorf("unchanged status was re-announced: %v", ev.Payload)
	}
}

func TestVoiceVideoFlags(t *testing.T) {
	bus := events.NewInProcBus()
	gw := realtime.NewGateway(bus, fakeVerifier{}, fakeMembers{
		"alice": {"s1"}, "bob": {"s1"},
	}, fakeVoiceChannels{"v1": "s1"}, []string{"*"}, slog.Default())
	mux := http.NewServeMux()
	mux.Handle("/ws", gw)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	alice := dial(t, srv, "alice")
	alice.next(time.Second) // Ready
	bob := dial(t, srv, "bob")
	bob.next(time.Second)
	alice.next(time.Second) // bob's presence

	alice.send(&realtimev1.ClientEvent{Payload: &realtimev1.ClientEvent_VoiceState{
		VoiceState: &realtimev1.VoiceState{ChannelId: "v1", Camera: true, ScreenSharing: true},
	}})
	ev := bob.waitFor(func(ev *realtimev1.ServerEvent) bool { return ev.GetVoiceStateChanged() != nil })
	if ev == nil {
		t.Fatal("bob never heard alice join voice")
	}
	p := ev.GetVoiceStateChanged().Participant
	if !p.Camera || !p.ScreenSharing {
		t.Errorf("flags not carried: %+v", p)
	}
	// A late joiner's Ready snapshot carries them too.
	carol := dial(t, srv, "bob")
	r := carol.next(time.Second).GetReady()
	if r == nil || len(r.VoiceParticipants) != 1 || !r.VoiceParticipants[0].ScreenSharing {
		t.Errorf("Ready voice participants = %+v", r.GetVoiceParticipants())
	}
}
