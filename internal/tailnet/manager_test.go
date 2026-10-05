package tailnet

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/restart"
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
	manager := NewManager("/tmp/state", http.NotFoundHandler(), slog.Default())
	manager.newRun = func(opts Options, _ *slog.Logger) runner {
		mu.Lock()
		defer mu.Unlock()
		run := &fakeRun{opts: opts, stopped: make(chan struct{})}
		started = append(started, run)
		return run
	}
	count := func() int { mu.Lock(); defer mu.Unlock(); return len(started) }
	last := func() *fakeRun { mu.Lock(); defer mu.Unlock(); return started[len(started)-1] }

	// Applied before Run: nothing starts yet.
	manager.Apply(Settings{Enabled: true, Hostname: "porch"})
	if count() != 0 {
		t.Fatal("must not start before Run")
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { manager.Run(ctx); close(done) }()
	time.Sleep(50 * time.Millisecond)
	if count() != 1 || last().opts.Hostname != "porch" || last().opts.StateDir != "/tmp/state" {
		t.Fatalf("started = %d, opts = %+v", count(), last().opts)
	}
	if manager.PublicURL() != "https://porch.example.ts.net" {
		t.Errorf("PublicURL = %q", manager.PublicURL())
	}

	// Same settings: no restart. Changed funnel: restart. Disabled: stop.
	manager.Apply(Settings{Enabled: true, Hostname: "porch"})
	if count() != 1 {
		t.Error("identical settings must not restart")
	}
	first := last()
	manager.Apply(Settings{Enabled: true, Hostname: "porch", Funnel: true})
	select {
	case <-first.stopped:
	case <-time.After(time.Second):
		t.Fatal("old node not stopped on funnel change")
	}
	if count() != 2 || !last().opts.Funnel {
		t.Errorf("expected a funnel restart, started = %d", count())
	}
	if st, on := manager.Status(context.Background()); !on || !st.Funnel {
		t.Errorf("status = %+v on=%v", st, on)
	}
	// The new node is served once the old one has stopped.
	waitFor(t, time.Second, "the funnel node", func() bool { return manager.PublicURL() != "" })
	second := last()
	manager.Apply(Settings{Enabled: false})
	select {
	case <-second.stopped:
	case <-time.After(time.Second):
		t.Fatal("node not stopped when disabled")
	}
	if _, on := manager.Status(context.Background()); on || manager.PublicURL() != "" {
		t.Error("disabled manager must report stopped and no URL")
	}

	// Default hostname; shutdown stops the node.
	manager.Apply(Settings{Enabled: true})
	waitFor(t, time.Second, "the default node", func() bool { return manager.PublicURL() != "" })
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

// scriptedRun is a node whose Serve returns when its test says so: with
// fail closed it returns an error even though ctx is live, and it ignores
// ctx until release is closed, like a node that is slow to stop.
type scriptedRun struct {
	url     string
	serving atomic.Bool
	fail    chan struct{}
	release chan struct{}
	stopped chan struct{}
}

func newScriptedRun(url string) *scriptedRun {
	return &scriptedRun{
		url: url, fail: make(chan struct{}), release: make(chan struct{}), stopped: make(chan struct{}),
	}
}

func (r *scriptedRun) Serve(ctx context.Context, _ http.Handler) error {
	defer close(r.stopped)
	r.serving.Store(true)
	select {
	case <-r.fail:
		return errors.New("tsnet went away")
	case <-ctx.Done():
	}
	<-r.release
	return ctx.Err()
}
func (r *scriptedRun) Status(context.Context) Status { return Status{State: "running", URL: r.url} }
func (r *scriptedRun) PublicURL() string             { return r.url }

func scriptedManager(t *testing.T) (*Manager, func() []*scriptedRun) {
	t.Helper()
	var mu sync.Mutex
	var started []*scriptedRun
	manager := NewManager(t.TempDir(), http.NotFoundHandler(), slog.Default())
	manager.newRun = func(Options, *slog.Logger) runner {
		mu.Lock()
		defer mu.Unlock()
		run := newScriptedRun(fmt.Sprintf("https://node%d.example.ts.net", len(started)+1))
		started = append(started, run)
		return run
	}
	runs := func() []*scriptedRun {
		mu.Lock()
		defer mu.Unlock()
		return append([]*scriptedRun(nil), started...)
	}
	return manager, runs
}

func runManager(t *testing.T, manager *Manager) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); manager.Run(ctx) }()
	t.Cleanup(func() {
		cancel()
		<-done
	})
}

func waitFor(t *testing.T, within time.Duration, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(within)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestManager_RestartsStoppedNode(t *testing.T) {
	manager, runs := scriptedManager(t)
	runManager(t, manager)
	t.Cleanup(func() {
		for _, run := range runs() {
			close(run.release)
		}
	})
	manager.Apply(Settings{Enabled: true, Hostname: "porch"})
	waitFor(t, time.Second, "the first node", func() bool { return manager.PublicURL() == "https://node1.example.ts.net" })

	first := runs()[0]
	close(first.fail)
	<-first.stopped

	waitFor(t, time.Second, "the dead address to go", func() bool { return manager.PublicURL() == "" })
	status, enabled := manager.Status(context.Background())
	if !enabled || status.State != "starting" || status.Error != "tsnet went away" {
		t.Errorf("status while down = %+v, enabled = %v", status, enabled)
	}

	waitFor(t, restart.BackoffMin+2*time.Second, "a restart", func() bool { return len(runs()) == 2 })
	waitFor(t, time.Second, "the new address", func() bool { return manager.PublicURL() == "https://node2.example.ts.net" })
	if status, _ := manager.Status(context.Background()); status.State != "running" || status.Error != "" {
		t.Errorf("status once back = %+v", status)
	}
}

func TestManager_StatusDoesNotWaitForOldNode(t *testing.T) {
	manager, runs := scriptedManager(t)
	runManager(t, manager)
	manager.Apply(Settings{Enabled: true, Hostname: "porch"})
	waitFor(t, time.Second, "the first node", func() bool { return manager.PublicURL() != "" })
	old := runs()[0]
	t.Cleanup(func() {
		select {
		case <-old.release:
		default:
			close(old.release)
		}
		for _, run := range runs()[1:] {
			close(run.release)
		}
	})

	applied := make(chan struct{})
	go func() {
		defer close(applied)
		manager.Apply(Settings{Enabled: true, Hostname: "stoop"})
	}()
	time.Sleep(50 * time.Millisecond)

	read := make(chan string)
	go func() {
		manager.Status(context.Background())
		read <- manager.PublicURL()
	}()
	select {
	case url := <-read:
		if url != "" {
			t.Errorf("PublicURL while the old node stops = %q", url)
		}
	case <-time.After(time.Second):
		t.Fatal("Status and PublicURL blocked on the old node stopping")
	}
	<-applied

	// The new node waits for the old one: they share a state dir.
	time.Sleep(50 * time.Millisecond)
	if runs()[1].serving.Load() {
		t.Fatal("new node started before the old one stopped")
	}
	close(old.release)
	waitFor(t, time.Second, "the new node", func() bool { return manager.PublicURL() == "https://node2.example.ts.net" })
}
