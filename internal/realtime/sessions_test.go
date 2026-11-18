package realtime_test

import (
	"context"
	"log/slog"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/realtime"
)

// waitUntil polls until cond holds, failing after two seconds.
func waitUntil(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met in time")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// A session is connected while any socket opened with it is open.
func TestSessionConnected(t *testing.T) {
	gw, _, srv := newTestGateway(t, fakeMembers{"casey": {"s1"}}, fakeVoiceChannels{})
	if gw.SessionConnected("session:casey") || gw.SessionConnected("") {
		t.Fatal("connected before any socket opened")
	}
	first := dial(t, srv, "casey")
	first.next(time.Second)
	if !gw.SessionConnected("session:casey") {
		t.Fatal("not connected with a socket open")
	}
	if gw.SessionConnected("session:other") || gw.SessionConnected("") {
		t.Fatal("another session or an empty id reads as connected")
	}
	second := dialMobile(t, srv, "casey")
	second.next(time.Second)
	_ = first.conn.Close(websocket.StatusNormalClosure, "")
	// Presence cleanup runs after the session count drops, so the count
	// falling to one proves the first socket's cleanup finished.
	waitUntil(t, func() bool { return gw.ConnectionCount() == 1 })
	if !gw.SessionConnected("session:casey") {
		t.Fatal("one socket closing dropped a session that still has another")
	}
	_ = second.conn.Close(websocket.StatusNormalClosure, "")
	waitUntil(t, func() bool { return !gw.SessionConnected("session:casey") })
}

// blockingDND holds a do-not-disturb lookup open once armed, as a slow
// database would.
type blockingDND struct {
	armed   atomic.Bool
	entered chan struct{}
	release chan struct{}
}

func (b *blockingDND) DoNotDisturb(ctx context.Context, _ string) (bool, *time.Time, error) {
	if b.armed.Load() {
		b.entered <- struct{}{}
		select {
		case <-b.release:
		case <-ctx.Done():
		}
	}
	return false, nil, nil
}

// A closing socket's session drops at once even while another of the same
// person's connections holds their presence lock in a slow lookup.
func TestSessionDropsWhilePresenceLockIsHeld(t *testing.T) {
	verifier := fakeVerifier{
		"casey-b": {UserID: "casey", Credential: authctx.Credential{ID: "session:b", Kind: authctx.CredentialSession}},
	}
	lookup := &blockingDND{entered: make(chan struct{}, 1), release: make(chan struct{})}
	gw := realtime.NewGateway(events.NewInProcBus(), verifier, fakeMembers{"casey": {"s1"}}, fakeVoiceChannels{}, []string{"*"}, slog.Default())
	gw.SetPresenceGrace(0)
	gw.UseDoNotDisturb(lookup)
	srv := httptest.NewServer(gw)
	t.Cleanup(srv.Close)
	t.Cleanup(func() { close(lookup.release) })

	first := dial(t, srv, "casey")
	first.next(time.Second)
	lookup.armed.Store(true)
	dial(t, srv, "casey-b")
	<-lookup.entered // the second connection now holds casey's presence lock

	_ = first.conn.Close(websocket.StatusNormalClosure, "")
	waitUntil(t, func() bool { return !gw.SessionConnected("session:casey") })
}
