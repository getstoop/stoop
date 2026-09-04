package ratelimit

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"connectrpc.com/connect"
)

// fakeRequest is the slice of connect.AnyRequest the interceptor reads.
type fakeRequest struct {
	connect.AnyRequest
	proc string
	addr string
	hdr  http.Header
}

func (f fakeRequest) Spec() connect.Spec  { return connect.Spec{Procedure: f.proc} }
func (f fakeRequest) Peer() connect.Peer  { return connect.Peer{Addr: f.addr} }
func (f fakeRequest) Header() http.Header { return f.hdr }

func TestInterceptorGuardsOnlyNamedProcedures(t *testing.T) {
	l := New(60, 1)
	calls := 0
	next := connect.UnaryFunc(func(context.Context, connect.AnyRequest) (connect.AnyResponse, error) {
		calls++
		return nil, nil
	})
	h := Interceptor(l, never, "/auth/Login")(next)
	req := fakeRequest{proc: "/auth/Login", addr: "192.0.2.1:1", hdr: http.Header{}}

	if _, err := h(context.Background(), req); err != nil {
		t.Fatalf("first call: %v", err)
	}
	_, err := h(context.Background(), req)
	var cerr *connect.Error
	if !errors.As(err, &cerr) || cerr.Code() != connect.CodeResourceExhausted {
		t.Fatalf("second call: err = %v, want ResourceExhausted", err)
	}
	if cerr.Meta().Get("Retry-After") == "" {
		t.Error("throttled error should carry Retry-After")
	}
	// Unguarded procedures from the same address are untouched.
	other := fakeRequest{proc: "/chat/Send", addr: "192.0.2.1:1", hdr: http.Header{}}
	if _, err := h(context.Background(), other); err != nil {
		t.Fatalf("unguarded procedure: %v", err)
	}
	if calls != 2 {
		t.Errorf("next called %d times, want 2", calls)
	}
}

func TestInterceptorTrustsForwardedForOnlyWhenTold(t *testing.T) {
	next := connect.UnaryFunc(func(context.Context, connect.AnyRequest) (connect.AnyResponse, error) { return nil, nil })
	mk := func(xff string) fakeRequest {
		return fakeRequest{proc: "/p", addr: "10.0.0.1:1", hdr: http.Header{"X-Forwarded-For": {xff}}}
	}
	// Untrusted: two "different" forwarded clients share the proxy's bucket.
	h := Interceptor(New(60, 1), never, "/p")(next)
	_, _ = h(context.Background(), mk("1.1.1.1"))
	if _, err := h(context.Background(), mk("2.2.2.2")); err == nil {
		t.Error("without TrustProxy X-Forwarded-For must not split buckets")
	}
	// Trusted: they don't.
	h = Interceptor(New(60, 1), always, "/p")(next)
	_, _ = h(context.Background(), mk("1.1.1.1"))
	if _, err := h(context.Background(), mk("2.2.2.2")); err != nil {
		t.Errorf("with TrustProxy forwarded clients get their own bucket: %v", err)
	}
}

// Trust predicates for the tests: the peer's headers are never or always
// believed.
func never(string) bool  { return false }
func always(string) bool { return true }
