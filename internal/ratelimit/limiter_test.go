package ratelimit

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/kv"
)

func newTestLimiter(perMinute, burst int) *Limiter {
	return New(kv.NewMemory(nil), "test", perMinute, burst)
}

// newClockedLimiter is a limiter whose clock, shared with its store, the
// test moves.
func newClockedLimiter(perMinute, burst int) (*Limiter, *time.Time) {
	at := time.Unix(1_700_000_000, 0)
	now := func() time.Time { return at }
	limiter := New(kv.NewMemory(now), "test", perMinute, burst)
	limiter.now = now
	return limiter, &at
}

func allow(t *testing.T, limiter *Limiter, key string) bool {
	t.Helper()
	allowed, err := limiter.Allow(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	return allowed
}

func TestLimiterBurstThenRefill(t *testing.T) {
	limiter, now := newClockedLimiter(60, 3) // 1/s, burst 3

	for request := range 3 {
		if !allow(t, limiter, "a") {
			t.Fatalf("request %d within burst should pass", request)
		}
	}
	if allow(t, limiter, "a") {
		t.Fatal("4th request must be throttled")
	}
	if !allow(t, limiter, "b") {
		t.Fatal("other keys have their own bucket")
	}
	*now = now.Add(time.Second)
	if !allow(t, limiter, "a") {
		t.Fatal("one token refills per second")
	}
	if allow(t, limiter, "a") {
		t.Fatal("only one token refilled")
	}
	// A long idle refills to the burst and no further.
	*now = now.Add(time.Hour)
	for request := range 3 {
		if !allow(t, limiter, "a") {
			t.Fatalf("request %d after a rest should pass", request)
		}
	}
	if allow(t, limiter, "a") {
		t.Fatal("a rest never banks more than the burst")
	}
}

func TestLimiterPerPeriod(t *testing.T) {
	at := time.Unix(1_700_000_000, 0)
	now := func() time.Time { return at }
	limiter := NewPer(kv.NewMemory(now), "test", 3, time.Hour)
	limiter.now = now
	for request := range 3 {
		if !allow(t, limiter, "a") {
			t.Fatalf("request %d within the hour's three should pass", request)
		}
	}
	if allow(t, limiter, "a") {
		t.Fatal("a 4th within the hour must be throttled")
	}
	at = at.Add(19 * time.Minute)
	if allow(t, limiter, "a") {
		t.Fatal("one comes back after 20 minutes, not 19")
	}
	at = at.Add(time.Minute)
	if !allow(t, limiter, "a") {
		t.Fatal("one comes back after 20 minutes")
	}
}

func TestLimiterDisabled(t *testing.T) {
	limiter := newTestLimiter(0, 0)
	if limiter.Enabled() {
		t.Fatal("0/min must mean disabled")
	}
	for range 100 {
		if !allow(t, limiter, "x") {
			t.Fatal("disabled limiter must allow everything")
		}
	}
	var none *Limiter
	if !allow(t, none, "x") {
		t.Fatal("nil limiter must allow everything")
	}
}

func TestLimiterIdleBucketsExpire(t *testing.T) {
	ctx := context.Background()
	limiter, now := newClockedLimiter(60, 1)
	allow(t, limiter, "a")
	if count, _ := limiter.buckets.Len(ctx); count != 1 {
		t.Fatalf("buckets = %d, want 1", count)
	}
	*now = now.Add(2 * time.Minute)
	allow(t, limiter, "b")
	if _, found, _ := limiter.buckets.Get(ctx, "a"); found {
		t.Fatal("fully refilled idle bucket should be gone")
	}
}

func TestMiddleware(t *testing.T) {
	limiter := newTestLimiter(60, 1)
	handler := Middleware(limiter, never, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	do := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/livekit/rtc", nil)
		req.RemoteAddr = "198.51.100.7:5555"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
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
	if Middleware(newTestLimiter(0, 0), never, http.NotFoundHandler()) == nil {
		t.Fatal("nil handler")
	}
}

// Only a trusted peer's X-Forwarded-For is believed: an untrusted caller
// can't mint a fresh bucket per made-up address.
func TestMiddlewareTrustsOnlyNamedPeers(t *testing.T) {
	seen := map[string]int{}
	limiter := newTestLimiter(60, 60)
	trusts := func(addr string) bool { return strings.HasPrefix(addr, "10.0.0.1:") }
	handler := Middleware(limiter, trusts, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen[ClientIP(r.RemoteAddr, r.Header, trusts)]++
		w.WriteHeader(http.StatusOK)
	}))
	call := func(peer, xff string) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = peer
		req.Header.Set("X-Forwarded-For", xff)
		handler.ServeHTTP(httptest.NewRecorder(), req)
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

func TestMiddlewareRefusesWhenStoreFails(t *testing.T) {
	limiter := New(kv.Broken(errors.New("store down")), "test", 60, 10)
	reached := false
	handler := Middleware(limiter, never, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/livekit/rtc", nil)
	req.RemoteAddr = "198.51.100.7:5555"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if reached {
		t.Fatal("a request the limiter could not account for reached the handler")
	}
}
