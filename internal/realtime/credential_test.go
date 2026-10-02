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

// Only a session opens the socket: a personal token and a bot token are
// refused at the handshake.
func TestOnlyASessionOpensTheSocket(t *testing.T) {
	verifier := fakeVerifier{
		"token": {UserID: "casey", Credential: authctx.Credential{
			ID: "token", Kind: authctx.CredentialPersonalToken, Grants: []authctx.Action{authctx.MessagesRead},
		}},
		"bot": {UserID: "uptime", Kind: authctx.KindBot, Credential: authctx.Credential{
			ID: "bot", Kind: authctx.CredentialBotToken, Grants: []authctx.Action{authctx.MessagesRead},
		}},
	}
	gw := realtime.NewGateway(events.NewInProcBus(), verifier, fakeMembers{
		"casey": {"s1"}, "uptime": {"s1"},
	}, fakeVoiceChannels{}, []string{"*"}, slog.Default())
	srv := httptest.NewServer(gw)
	defer srv.Close()

	for _, credential := range []string{"token", "bot"} {
		if _, res, err := tryDial(srv, credential); err == nil || res == nil || res.StatusCode != http.StatusForbidden {
			t.Errorf("%s: err = %v, response = %v", credential, err, res)
		}
	}
	casey := dial(t, srv, "casey")
	if casey.next(time.Second).GetReady() == nil {
		t.Fatal("a session never became ready")
	}
	_ = casey.conn.Close(websocket.StatusNormalClosure, "")
}

// Revoking one session closes its socket and leaves the person's other
// session alone.
func TestRevocationClosesOnlyItsOwnSocket(t *testing.T) {
	session := func(id string) authctx.Identity {
		return authctx.Identity{UserID: "casey", Credential: authctx.Credential{ID: id, Kind: authctx.CredentialSession}}
	}
	bus := events.NewInProcBus()
	gw := realtime.NewGateway(bus, fakeVerifier{"laptop": session("laptop"), "phone": session("phone")},
		fakeMembers{"casey": {"s1"}}, fakeVoiceChannels{}, []string{"*"}, slog.Default())
	srv := httptest.NewServer(gw)
	defer srv.Close()

	laptop := dial(t, srv, "laptop")
	laptop.waitFor(presenceOf("casey")) // Ready, then casey's own presence
	phone := dial(t, srv, "phone")
	if phone.next(time.Second).GetReady() == nil {
		t.Fatal("the second session never became ready")
	}
	bus.Publish("user:casey", revoked("laptop"))
	if !laptop.closed(2*time.Second) || laptop.closeCode != realtime.StatusCredentialRevoked {
		t.Fatalf("revoked session's socket: code = %v", laptop.closeCode)
	}
	if event := phone.next(300 * time.Millisecond); event != nil {
		t.Fatalf("the other session heard the revocation: %v", event.Payload)
	}
	_ = phone.conn.Close(websocket.StatusNormalClosure, "")
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
