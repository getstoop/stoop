package tailnet

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"testing"
	"time"
)

type fakeRun struct {
	opts    Options
	stopped chan struct{}
}

func (f *fakeRun) Serve(ctx context.Context, _ http.Handler) error {
	<-ctx.Done()
	close(f.stopped)
	return ctx.Err()
}
func (f *fakeRun) Status(context.Context) Status {
	return Status{State: "running", Funnel: f.opts.Funnel}
}
func (f *fakeRun) PublicURL() string { return "https://" + f.opts.Hostname + ".example.ts.net" }

func TestManager_Reconciles(t *testing.T) {
	var mu sync.Mutex
	var started []*fakeRun
	m := NewManager("/tmp/state", http.NotFoundHandler(), slog.Default())
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
	m.Apply(Settings{Enabled: true, Hostname: "porch"})
	if count() != 0 {
		t.Fatal("must not start before Run")
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { m.Run(ctx); close(done) }()
	time.Sleep(50 * time.Millisecond)
	if count() != 1 || last().opts.Hostname != "porch" || last().opts.StateDir != "/tmp/state" {
		t.Fatalf("started = %d, opts = %+v", count(), last().opts)
	}
	if m.PublicURL() != "https://porch.example.ts.net" {
		t.Errorf("PublicURL = %q", m.PublicURL())
	}

	// Same settings: no restart. Changed funnel: restart. Disabled: stop.
	m.Apply(Settings{Enabled: true, Hostname: "porch"})
	if count() != 1 {
		t.Error("identical settings must not restart")
	}
	first := last()
	m.Apply(Settings{Enabled: true, Hostname: "porch", Funnel: true})
	select {
	case <-first.stopped:
	case <-time.After(time.Second):
		t.Fatal("old node not stopped on funnel change")
	}
	if count() != 2 || !last().opts.Funnel {
		t.Errorf("expected a funnel restart, started = %d", count())
	}
	if st, on := m.Status(context.Background()); !on || !st.Funnel {
		t.Errorf("status = %+v on=%v", st, on)
	}
	second := last()
	m.Apply(Settings{Enabled: false})
	select {
	case <-second.stopped:
	case <-time.After(time.Second):
		t.Fatal("node not stopped when disabled")
	}
	if _, on := m.Status(context.Background()); on || m.PublicURL() != "" {
		t.Error("disabled manager must report stopped and no URL")
	}

	// Default hostname; shutdown stops the node.
	m.Apply(Settings{Enabled: true})
	time.Sleep(20 * time.Millisecond)
	if last().opts.Hostname != "stoop" {
		t.Errorf("default hostname = %q", last().opts.Hostname)
	}
	third := last()
	cancel()
	select {
	case <-third.stopped:
	case <-time.After(time.Second):
		t.Fatal("node not stopped on shutdown")
	}
	<-done
}

// Media describes the LiveKit sidecar, not anything the operator sets from
// the admin page, so it reaches every node the manager starts without
// being part of the settings that cause a restart.
func TestManager_CarriesMedia(t *testing.T) {
	var mu sync.Mutex
	var started []*fakeRun
	m := NewManager(t.TempDir(), http.NotFoundHandler(), slog.Default())
	m.newRun = func(o Options, _ *slog.Logger) runner {
		mu.Lock()
		defer mu.Unlock()
		r := &fakeRun{opts: o, stopped: make(chan struct{})}
		started = append(started, r)
		return r
	}
	media := Media{Host: "livekit", TCPPort: 7881, UDPStart: 50000, UDPEnd: 50100}
	m.UseMedia(media)
	seen := make(chan string, 4)
	m.UseAddressHook(func(ip string) { seen <- ip })

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); m.Run(ctx) }()

	m.Apply(Settings{Enabled: true, Hostname: "porch"})
	deadline := time.Now().Add(2 * time.Second)
	for {
		mu.Lock()
		n := len(started)
		mu.Unlock()
		if n > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("no node was started")
		}
		time.Sleep(5 * time.Millisecond)
	}
	mu.Lock()
	got := started[0].opts.Media
	hook := started[0].opts.OnAddress
	mu.Unlock()
	if got != media {
		t.Fatalf("node started with Media %+v, want %+v", got, media)
	}
	// The address hook reaches the node too — it is how LiveKit learns an
	// address that only exists after joining.
	if hook == nil {
		t.Fatal("node started without the address hook")
	}
	hook("100.64.1.2")
	if ip := <-seen; ip != "100.64.1.2" {
		t.Fatalf("hook delivered %q", ip)
	}

	// Restarting for a settings change keeps carrying media.
	m.Apply(Settings{Enabled: true, Hostname: "stoop"})
	mu.Lock()
	n := len(started)
	newest := started[n-1].opts.Media
	mu.Unlock()
	if n < 2 || newest != media {
		t.Fatalf("restarted node has Media %+v after %d starts, want %+v", newest, n, media)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("manager did not stop")
	}
}
