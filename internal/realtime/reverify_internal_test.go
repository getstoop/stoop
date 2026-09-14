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

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/events"
)

type flippingVerifier struct{ revoked atomic.Bool }

func (v *flippingVerifier) VerifyRequest(context.Context, http.Header) (authctx.Identity, error) {
	if v.revoked.Load() {
		return authctx.Identity{}, errors.New("gone")
	}
	return authctx.Identity{UserID: "alice", Credential: authctx.Credential{ID: "t", Kind: authctx.CredentialPersonalToken, Grants: []authctx.Action{authctx.MessagesRead}}}, nil
}

type noMembers struct{}

func (noMembers) ListSpaceIDs(context.Context, string) ([]string, error) { return nil, nil }

type noChannels struct{}

func (noChannels) VoiceChannelSpace(context.Context, string) (string, error) { return "", nil }
func (noChannels) DMParticipants(context.Context, string) ([]string, error)  { return nil, nil }

// A credential that stops verifying (expired, setting turned off, deleted
// by the CLI) ends its socket at the next ping.
func TestSocketClosesWhenTheCredentialStopsVerifying(t *testing.T) {
	v := &flippingVerifier{}
	gw := NewGateway(events.NewInProcBus(), v, noMembers{}, noChannels{}, []string{"*"}, slog.Default())
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
	v.revoked.Store(true)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, _, err = conn.Read(ctx)
	if websocket.CloseStatus(err) != StatusCredentialRevoked {
		t.Fatalf("socket ended with %v, want close %d", err, StatusCredentialRevoked)
	}
}
