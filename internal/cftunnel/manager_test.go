package cftunnel

import (
	"context"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"
)

type fakeRun struct {
	opts    Options
	stopped chan struct{}
}

func (f *fakeRun) Run(ctx context.Context) {
	<-ctx.Done()
	close(f.stopped)
}
func (f *fakeRun) Status() Status {
	return Status{State: "running"}
}

func TestManager_Reconciles(t *testing.T) {
	var mu sync.Mutex
	var started []*fakeRun
	m := NewManager(os.Args[0], quiet)
	m.newRun = func(o Options, _ *slog.Logger) runner {
		mu.Lock()
		defer mu.Unlock()
		r := &fakeRun{opts: o, stopped: make(chan struct{})}
		started = append(started, r)
		return r
	}
	count := func() int { mu.Lock(); defer mu.Unlock(); return len(started) }
	last := func() *fakeRun { mu.Lock(); defer mu.Unlock(); return started[len(started)-1] }

	// Applied before Run: nothing starts yet.
	m.Apply(Settings{Enabled: true, Token: "one"})
	if count() != 0 {
		t.Fatal("must not start before Run")
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { m.Run(ctx); close(done) }()
	time.Sleep(50 * time.Millisecond)
	if count() != 1 || last().opts.Token != "one" {
		t.Fatalf("started = %d", count())
	}
	if st, on := m.Status(); !on || st.State != "running" {
		t.Errorf("status = %+v on=%v", st, on)
	}

	// Same settings: no restart. New token: restart. Disabled: stop.
	m.Apply(Settings{Enabled: true, Token: "one"})
	if count() != 1 {
		t.Error("identical settings must not restart")
	}
	first := last()
	m.Apply(Settings{Enabled: true, Token: "two"})
	select {
	case <-first.stopped:
	case <-time.After(time.Second):
		t.Fatal("old connector not stopped on a new token")
	}
	if count() != 2 {
		t.Errorf("expected a restart, started = %d", count())
	}
	second := last()
	m.Apply(Settings{Enabled: false, Token: "two"})
	select {
	case <-second.stopped:
	case <-time.After(time.Second):
		t.Fatal("connector not stopped when disabled")
	}
	if st, on := m.Status(); on || st.State != "stopped" {
		t.Errorf("status = %+v on=%v", st, on)
	}

	// Enabled with no token is off.
	m.Apply(Settings{Enabled: true})
	if count() != 2 {
		t.Error("must not start without a token")
	}
	cancel()
	<-done
}

func TestManager_MissingBinary(t *testing.T) {
	m := NewManager("/nonexistent/cloudflared", quiet)
	if st, on := m.Status(); on || st.State != "missing" {
		t.Errorf("status = %+v on=%v", st, on)
	}
}
