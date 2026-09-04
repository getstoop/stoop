package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLimiterBurstThenRefill(t *testing.T) {
	l := New(60, 3) // 1/s, burst 3
	now := time.Unix(1_700_000_000, 0)
	l.now = func() time.Time { return now }

	for i := range 3 {
		if !l.Allow("a") {
			t.Fatalf("request %d within burst should pass", i)
		}
	}
	if l.Allow("a") {
		t.Fatal("4th request must be throttled")
	}
	if !l.Allow("b") {
		t.Fatal("other keys have their own bucket")
	}
	now = now.Add(time.Second)
	if !l.Allow("a") {
		t.Fatal("one token refills per second")
	}
}

func TestLimiterDisabled(t *testing.T) {
	l := New(0, 0)
	if l.Enabled() {
		t.Fatal("0/min must mean disabled")
	}
	for range 100 {
		if !l.Allow("x") {
			t.Fatal("disabled limiter must allow everything")
		}
	}
	var nilL *Limiter
	if !nilL.Allow("x") {
		t.Fatal("nil limiter must allow everything")
	}
}

func TestLimiterGC(t *testing.T) {
	l := New(60, 1)
	now := time.Unix(1_700_000_000, 0)
	l.now = func() time.Time { return now }
	l.Allow("a")
	if len(l.buckets) != 1 {
		t.Fatalf("buckets = %d, want 1", len(l.buckets))
	}
	now = now.Add(2 * time.Minute)
	l.Allow("b")
	if _, ok := l.buckets["a"]; ok {
		t.Fatal("fully refilled idle bucket should be pruned")
	}
}

func TestMiddleware(t *testing.T) {
	l := New(60, 1)
	h := Middleware(l, never, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	do := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/livekit/rtc", nil)
		req.RemoteAddr = "198.51.100.7:5555"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	if rec := do(); rec.Code != http.StatusTeapot {
		t.Fatalf("first request: %d", rec.Code)
	}
	rec := do()
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("second request: %d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("429 should carry Retry-After")
	}
	// Disabled limiter returns next unwrapped.
	if Middleware(New(0, 0), never, http.NotFoundHandler()) == nil {
		t.Fatal("nil handler")
	}
}

// Only a trusted peer's X-Forwarded-For is believed: an untrusted caller
// can't mint a fresh bucket per made-up address.
func TestMiddlewareTrustsOnlyNamedPeers(t *testing.T) {
	seen := map[string]int{}
	l := New(60, 60)
	trusts := func(addr string) bool { return strings.HasPrefix(addr, "10.0.0.1:") }
	h := Middleware(l, trusts, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen[ClientIP(r.RemoteAddr, r.Header, trusts)]++
		w.WriteHeader(http.StatusOK)
	}))
	call := func(peer, xff string) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = peer
		req.Header.Set("X-Forwarded-For", xff)
		h.ServeHTTP(httptest.NewRecorder(), req)
	}
	call("10.0.0.1:5000", "203.0.113.9") // the proxy speaks for its caller
	call("8.8.8.8:5000", "203.0.113.9")  // a stranger's claim is ignored
	if seen["203.0.113.9"] != 1 {
		t.Errorf("trusted proxy's forwarded address not used: %v", seen)
	}
	if seen["8.8.8.8"] != 1 {
		t.Errorf("untrusted peer should be keyed by its own address: %v", seen)
	}
}
