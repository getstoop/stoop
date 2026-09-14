package realtime_test

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/realtime"
)

func message(spaceID, channelID string) *realtimev1.ServerEvent {
	return events.Stamp(&realtimev1.ServerEvent{Payload: &realtimev1.ServerEvent_MessageCreated{
		MessageCreated: &chatv1.Message{Id: "m", SpaceId: spaceID, ChannelId: channelID},
	}})
}

// activity is an item about a message in spaceID, or a direct message
// when spaceID is "".
func activity(spaceID string) *realtimev1.ServerEvent {
	return events.Stamp(&realtimev1.ServerEvent{Payload: &realtimev1.ServerEvent_ActivityItemCreated{
		ActivityItemCreated: &realtimev1.ActivityItemCreated{Item: &chatv1.ActivityItem{Id: "a", SpaceId: spaceID}},
	}})
}

func presenceOf(userID string) func(*realtimev1.ServerEvent) bool {
	return func(e *realtimev1.ServerEvent) bool {
		return e.GetPresenceChanged() != nil && e.GetPresenceChanged().UserId == userID
	}
}

func revoked(credentialID string) *realtimev1.ServerEvent {
	return events.Stamp(&realtimev1.ServerEvent{Payload: &realtimev1.ServerEvent_CredentialRevoked{
		CredentialRevoked: &realtimev1.CredentialRevoked{CredentialId: credentialID},
	}})
}

func TestTokenHearsOnlyWhatItCovers(t *testing.T) {
	token := func(id string, bounded bool, spaces []string, grants ...authctx.Action) authctx.Identity {
		return authctx.Identity{UserID: "alice", Credential: authctx.Credential{
			ID: id, Kind: authctx.CredentialPersonalToken, Grants: grants, Bounded: bounded, Spaces: spaces,
		}}
	}
	verifier := fakeVerifier{
		"ro":  token("ro", true, []string{"s1"}, authctx.MessagesRead),
		"dm":  token("dm", false, nil, authctx.MessagesRead, authctx.DMsRead, authctx.MessagesPost),
		"act": token("act", false, nil, authctx.ActivityRead, authctx.MessagesRead),
		"bot": {UserID: "ops", Kind: authctx.KindBot, Credential: authctx.Credential{ID: "b", Kind: authctx.CredentialBotToken, Grants: []authctx.Action{authctx.MessagesRead}}},
	}
	bus := events.NewInProcBus()
	gw := realtime.NewGateway(bus, verifier, fakeMembers{
		"alice": {"s1", "s2"}, "bob": {"s1"}, "ops": {"s1"},
	}, fakeVoiceChannels{"v1": "s1"}, []string{"*"}, slog.Default())
	srv := httptest.NewServer(gw)
	defer srv.Close()

	// A bot's token doesn't open the socket at all.
	if _, res, err := tryDial(srv, "bot"); err == nil || res == nil || res.StatusCode != http.StatusForbidden {
		t.Fatalf("bot token: err = %v, status = %v", err, res)
	}

	bob := dial(t, srv, "bob")
	bob.waitFor(presenceOf("bob")) // Ready, then his own presence

	// A token limited to s1 with messages.read: Ready lists s1 alone, s2's
	// events never arrive, and neither do direct messages or activity.
	ro := dial(t, srv, "ro")
	if r := ro.next(time.Second).GetReady(); r == nil || len(r.SpaceIds) != 1 || r.SpaceIds[0] != "s1" {
		t.Fatalf("ro ready = %+v", r)
	}
	bob.waitFor(presenceOf("alice"))
	bus.Publish("space:s2", message("s2", "c2"))
	bus.Publish("user:alice", message("", "dm1"))
	bus.Publish("user:alice", activity(""))
	bus.Publish("space:s1", message("s1", "c1"))
	if ev := ro.waitFor(func(e *realtimev1.ServerEvent) bool { return e.GetMessageCreated() != nil }); ev == nil || ev.GetMessageCreated().SpaceId != "s1" {
		t.Fatalf("ro's first message = %v", ev)
	}
	if ev := ro.next(300 * time.Millisecond); ev != nil {
		t.Fatalf("ro heard something it wasn't granted: %v", ev.Payload)
	}
	bob.waitFor(func(e *realtimev1.ServerEvent) bool { return e.GetMessageCreated() != nil })

	// Without messages.post its typing isn't relayed; without voice.join
	// its voice state is dropped.
	ro.send(&realtimev1.ClientEvent{Payload: &realtimev1.ClientEvent_Typing{Typing: &realtimev1.Typing{SpaceId: "s1", ChannelId: "c1"}}})
	ro.send(voiceEvent("v1", false))
	if ev := bob.next(300 * time.Millisecond); ev != nil {
		t.Fatalf("bob heard a read-only token act: %v", ev.Payload)
	}

	// An unbounded token with dms.read hears direct messages, but not
	// activity, and its typing in a space it may post to is relayed.
	dm := dial(t, srv, "dm")
	if r := dm.next(time.Second).GetReady(); r == nil || len(r.SpaceIds) != 2 {
		t.Fatalf("dm ready = %+v", r)
	}
	bus.Publish("user:alice", activity(""))
	bus.Publish("user:alice", message("", "dm1"))
	if ev := dm.waitFor(func(e *realtimev1.ServerEvent) bool {
		return e.GetMessageCreated() != nil || e.GetActivityItemCreated() != nil
	}); ev == nil || ev.GetMessageCreated() == nil {
		t.Fatalf("dm token: first event = %v", ev)
	}
	dm.send(&realtimev1.ClientEvent{Payload: &realtimev1.ClientEvent_Typing{Typing: &realtimev1.Typing{SpaceId: "s1", ChannelId: "c1"}}})
	if ev := bob.waitFor(func(e *realtimev1.ServerEvent) bool { return e.GetUserTyping() != nil }); ev == nil {
		t.Fatal("bob never saw the posting token type")
	}
	dm.waitFor(func(e *realtimev1.ServerEvent) bool { return e.GetUserTyping() != nil }) // her own relay

	// An activity item previews a message, so activity.read alone isn't
	// enough: a token with messages.read but no dms.read hears the item
	// about a space message and not the one about a direct message.
	act := dial(t, srv, "act")
	if r := act.next(time.Second).GetReady(); r == nil {
		t.Fatal("act never became ready")
	}
	bus.Publish("user:alice", activity(""))
	bus.Publish("user:alice", activity("s1"))
	if ev := act.waitFor(func(e *realtimev1.ServerEvent) bool { return e.GetActivityItemCreated() != nil }); ev == nil || ev.GetActivityItemCreated().Item.SpaceId != "s1" {
		t.Fatalf("act's first activity = %v", ev)
	}
	if ev := act.next(300 * time.Millisecond); ev != nil {
		t.Fatalf("act heard an item it couldn't read: %v", ev.Payload)
	}

	// Revoking one token closes its socket with the revoked code and
	// leaves the other alone.
	bus.Publish("user:alice", revoked("ro"))
	if !ro.closed(2*time.Second) || ro.closeCode != realtime.StatusCredentialRevoked {
		t.Fatalf("ro socket after revocation: closed = %v, code = %v", ro.closeCode != 0, ro.closeCode)
	}
	if ev := dm.next(300 * time.Millisecond); ev != nil {
		t.Fatalf("dm heard another credential's revocation: %v", ev.Payload)
	}
	_ = dm.conn.Close(websocket.StatusNormalClosure, "")
	_ = bob.conn.Close(websocket.StatusNormalClosure, "")
}

func TestSessionHearsEverythingAndItsRevocation(t *testing.T) {
	bus := events.NewInProcBus()
	gw := realtime.NewGateway(bus, fakeVerifier{}, fakeMembers{"alice": {"s1"}}, fakeVoiceChannels{}, []string{"*"}, slog.Default())
	srv := httptest.NewServer(gw)
	defer srv.Close()

	alice := dial(t, srv, "alice")
	alice.waitFor(presenceOf("alice")) // Ready, then her own presence
	bus.Publish("user:alice", activity(""))
	bus.Publish("user:alice", message("", "dm1"))
	bus.Publish("space:s1", message("s1", "c1"))
	for _, want := range []string{"activity", "dm", "space"} {
		if ev := alice.next(time.Second); ev == nil {
			t.Fatalf("session never heard the %s event", want)
		}
	}
	// Logging out elsewhere: this tab is told, then cut off.
	bus.Publish("user:alice", revoked("session:alice"))
	if ev := alice.next(time.Second); ev == nil || ev.GetCredentialRevoked() == nil {
		t.Fatalf("expected CredentialRevoked, got %v", ev)
	}
	if !alice.closed(2*time.Second) || alice.closeCode != realtime.StatusCredentialRevoked {
		t.Fatalf("session socket after revocation: code = %v", alice.closeCode)
	}
}
