package realtime

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"google.golang.org/protobuf/proto"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/events"
)

// flippingVerifier answers for alice's session until revoked (no session)
// or failing (the check itself fails, as with the database down).
type flippingVerifier struct {
	revoked, failing atomic.Bool
	checks           atomic.Int64
}

func (v *flippingVerifier) VerifyRequest(context.Context, http.Header) (authctx.Identity, error) {
	v.checks.Add(1)
	switch {
	case v.revoked.Load():
		return authctx.Identity{}, authctx.ErrNoSession
	case v.failing.Load():
		return authctx.Identity{}, errors.New("connection pool closed")
	}
	return authctx.Identity{UserID: "alice", Credential: authctx.Credential{ID: "t", Kind: authctx.CredentialSession}}, nil
}

// The upgrade says signed out only when there is no session; a check that
// failed is the server's trouble.
func TestUpgradeTellsNoSessionFromAFailedCheck(t *testing.T) {
	verifier := &flippingVerifier{}
	gw := NewGateway(events.NewInProcBus(), verifier, noMembers{}, noChannels{}, []string{"*"}, slog.Default())
	srv := httptest.NewServer(gw)
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")

	for _, tc := range []struct {
		name             string
		revoked, failing bool
		want             int
	}{
		{"no session", true, false, http.StatusUnauthorized},
		{"failed check", false, true, http.StatusServiceUnavailable},
	} {
		verifier.revoked.Store(tc.revoked)
		verifier.failing.Store(tc.failing)
		_, resp, err := websocket.Dial(context.Background(), url, nil)
		if err == nil || resp == nil || resp.StatusCode != tc.want {
			status := 0
			if resp != nil {
				status = resp.StatusCode
			}
			t.Errorf("%s: upgrade answered %d (%v), want %d", tc.name, status, err, tc.want)
		}
	}
}

// A re-check that fails at a ping closes the socket as retryable, not as
// revoked: the session may be fine, but an unverified socket must not stay
// subscribed.
func TestFailedReverifyClosesAsRetryable(t *testing.T) {
	verifier := &flippingVerifier{}
	gw := NewGateway(events.NewInProcBus(), verifier, noMembers{}, noChannels{}, []string{"*"}, slog.Default())
	gw.pingInterval = 50 * time.Millisecond
	srv := httptest.NewServer(gw)
	defer srv.Close()

	conn, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(srv.URL, "http"), &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer x"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.CloseNow() }()
	if _, _, err := conn.Read(context.Background()); err != nil { // Ready
		t.Fatal(err)
	}
	verifier.failing.Store(true)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, _, err = conn.Read(ctx)
	if websocket.CloseStatus(err) != websocket.StatusTryAgainLater {
		t.Fatalf("socket ended with %v, want close %d", err, websocket.StatusTryAgainLater)
	}
}

type noMembers struct{}

func (noMembers) ListSpaceIDs(context.Context, string) ([]string, error) { return nil, nil }

type noChannels struct{}

func (noChannels) VoiceChannelSpace(context.Context, string) (string, error) { return "", nil }
func (noChannels) DMParticipants(context.Context, string) ([]string, error)  { return nil, nil }

// A session that stops verifying (expired, or deleted by the CLI) ends
// its socket at the next ping.
func TestSocketClosesWhenTheCredentialStopsVerifying(t *testing.T) {
	verifier := &flippingVerifier{}
	gw := NewGateway(events.NewInProcBus(), verifier, noMembers{}, noChannels{}, []string{"*"}, slog.Default())
	gw.pingInterval = 50 * time.Millisecond
	srv := httptest.NewServer(gw)
	defer srv.Close()

	conn, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(srv.URL, "http"), &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer x"}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := conn.Read(context.Background()); err != nil { // Ready
		t.Fatal(err)
	}
	verifier.revoked.Store(true)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, _, err = conn.Read(ctx)
	if websocket.CloseStatus(err) != StatusCredentialRevoked {
		t.Fatalf("socket ended with %v, want close %d", err, StatusCredentialRevoked)
	}
}

// stuckChannels never answers a voice channel lookup before its context
// ends, like a database that has stopped responding, and says when one
// has started.
type stuckChannels struct {
	noChannels
	started chan struct{}
}

func (channels stuckChannels) VoiceChannelSpace(ctx context.Context, _ string) (string, error) {
	channels.started <- struct{}{}
	<-ctx.Done()
	return "", ctx.Err()
}

// A client event whose lookup hangs holds the connection's other work for
// at most the lookup timeout: events published meanwhile still arrive.
func TestAStuckLookupDoesNotStallTheConnection(t *testing.T) {
	bus := events.NewInProcBus()
	channels := stuckChannels{started: make(chan struct{}, 1)}
	gw := NewGateway(bus, &flippingVerifier{}, noMembers{}, channels, []string{"*"}, slog.Default())
	gw.lookupTimeout = 100 * time.Millisecond
	srv := httptest.NewServer(gw)
	defer srv.Close()

	conn, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(srv.URL, "http"), &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer x"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.CloseNow() }()
	if _, _, err := conn.Read(context.Background()); err != nil { // Ready
		t.Fatal(err)
	}
	report, err := proto.Marshal(&realtimev1.ClientEvent{Payload: &realtimev1.ClientEvent_VoiceState{
		VoiceState: &realtimev1.VoiceState{ChannelId: "v1"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.Write(context.Background(), websocket.MessageBinary, report); err != nil {
		t.Fatal(err)
	}
	select {
	case <-channels.started:
	case <-time.After(2 * time.Second):
		t.Fatal("the voice report was never looked up")
	}
	bus.Publish(events.UserTopic("alice"), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_Ping{Ping: &realtimev1.Ping{}},
	}))

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, _, err := conn.Read(ctx); err != nil {
		t.Fatalf("an event published behind the stuck lookup never arrived: %v", err)
	}
}
