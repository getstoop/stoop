package diag

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
)

type fakeRequest struct {
	connect.AnyRequest
	proc string
}

func (f fakeRequest) Spec() connect.Spec { return connect.Spec{Procedure: f.proc} }

func TestInterceptorRecordsUnaryCalls(t *testing.T) {
	s := NewRPCStats()
	boom := connect.NewError(connect.CodeInternal, errors.New("boom"))
	calls := 0
	next := connect.UnaryFunc(func(context.Context, connect.AnyRequest) (connect.AnyResponse, error) {
		calls++
		if calls == 2 {
			return nil, boom
		}
		return nil, nil
	})
	h := interceptor(s)(next)
	req := fakeRequest{proc: "/stoop.chat.v1.ChatService/ListMessages"}
	if _, err := h(context.Background(), req); err != nil {
		t.Fatalf("first call: %v", err)
	}
	if _, err := h(context.Background(), req); !errors.Is(err, boom) {
		t.Fatalf("second call: err = %v, want the handler's error passed through", err)
	}
	got := s.Procedures(SinceStart)
	if len(got) != 1 || got[0].Procedure != "ChatService.ListMessages" {
		t.Fatalf("procedures = %+v", got)
	}
	if got[0].Calls != 2 || got[0].Errors != 1 {
		t.Errorf("calls %d errors %d", got[0].Calls, got[0].Errors)
	}
	if got[0].Buckets[numBuckets-1].Count != 2 {
		t.Errorf("both durations should land in the histogram: %+v", got[0].Buckets)
	}
}

func TestInterceptorPassesStreamsThrough(t *testing.T) {
	s := NewRPCStats()
	called := false
	next := connect.StreamingHandlerFunc(func(context.Context, connect.StreamingHandlerConn) error {
		called = true
		return nil
	})
	var ic connect.Interceptor = interceptor(s)
	if err := ic.WrapStreamingHandler(next)(context.Background(), nil); err != nil || !called {
		t.Fatalf("streaming handler: called %v err %v", called, err)
	}
	if s.CallsTotal() != 0 {
		t.Error("streams must not be recorded")
	}
}
