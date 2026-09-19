package diag

import (
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"
)

func TestProcedureName(t *testing.T) {
	cases := map[string]string{
		"/stoop.chat.v1.ChatService/ListMessages":      "ChatService.ListMessages",
		"/stoop.instance.v1.InstanceService/GetHealth": "InstanceService.GetHealth",
		"/Plain/Method": "Plain.Method",
		"NoSlash":       "NoSlash",
	}
	for in, want := range cases {
		if got := procedureName(in); got != want {
			t.Errorf("procedureName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRPCStatsErrorCounting(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want int64
	}{
		{"nil", nil, 0},
		{"canceled", connect.NewError(connect.CodeCanceled, errors.New("gone")), 0},
		{"connect", connect.NewError(connect.CodeInternal, errors.New("boom")), 1},
		{"plain", errors.New("boom"), 1},
	}
	for _, c := range cases {
		s := NewRPCStats()
		s.Observe("/stoop.chat.v1.ChatService/Send", time.Millisecond, c.err)
		if s.ErrorsTotal() != c.want || s.CallsTotal() != 1 {
			t.Errorf("%s: errors %d (want %d), calls %d", c.name, s.ErrorsTotal(), c.want, s.CallsTotal())
		}
		if got := s.Procedures(SinceStart)[0].Errors; got != c.want {
			t.Errorf("%s: procedure errors %d, want %d", c.name, got, c.want)
		}
	}
}

func TestRPCStatsProceduresSortedByP95(t *testing.T) {
	s := NewRPCStats()
	for range 20 {
		s.Observe("/stoop.a.v1.A/Fast", time.Millisecond, nil)
		s.Observe("/stoop.a.v1.A/Slow", time.Second, nil)
		s.Observe("/stoop.a.v1.A/Mid", 50*time.Millisecond, nil)
	}
	got := s.Procedures(Last5Minutes)
	names := make([]string, len(got))
	for i, p := range got {
		names[i] = p.Procedure
	}
	want := []string{"A.Slow", "A.Mid", "A.Fast"}
	for i := range want {
		if i >= len(names) || names[i] != want[i] {
			t.Fatalf("order = %v, want %v", names, want)
		}
	}
	if got[0].Calls != 20 || got[0].Max != time.Second || got[0].P50 == 0 || len(got[0].Buckets) != numBuckets {
		t.Errorf("Slow row: %+v", got[0])
	}
}

func TestRPCStatsWindowDropsOld(t *testing.T) {
	s := NewRPCStats()
	s.Observe("/stoop.a.v1.A/Old", time.Millisecond, errors.New("x"))
	for range minuteRing {
		s.Rotate()
	}
	s.Observe("/stoop.a.v1.A/New", time.Millisecond, nil)
	if got := s.Procedures(Last5Minutes); len(got) != 1 || got[0].Procedure != "A.New" {
		t.Errorf("Last5Minutes = %+v, want only A.New", got)
	}
	if got := s.Procedures(SinceStart); len(got) != 2 {
		t.Errorf("SinceStart has %d rows, want 2", len(got))
	}
}

func TestRPCStatsObserveDoesNotAllocate(t *testing.T) {
	s := NewRPCStats()
	const proc = "/stoop.a.v1.A/Hot"
	s.Observe(proc, time.Millisecond, nil)
	allocs := testing.AllocsPerRun(100, func() { s.Observe(proc, time.Millisecond, nil) })
	if allocs != 0 {
		t.Errorf("Observe allocates %v per call", allocs)
	}
}
