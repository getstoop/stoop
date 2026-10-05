package tailnet

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/getstoop/stoop/internal/restart"
)

// Settings is what the operator controls at runtime (from the admin page
// or the environment): whether the node runs and how.
type Settings struct {
	Enabled    bool
	Hostname   string
	AuthKey    string
	ControlURL string
	Funnel     bool
}

// runner is a Server, or a fake in tests.
type runner interface {
	Serve(ctx context.Context, handler http.Handler) error
	Status(ctx context.Context) Status
	PublicURL() string
}

// Manager owns at most one wanted node and reconciles it with the settings
// in force: Apply starts, stops, or replaces it as needed, and settings
// applied before Run are honoured once Run starts. A node that stops while
// still wanted is started again with backoff. The node identity lives in
// the state dir, so a restart keeps the same device.
type Manager struct {
	stateDir  string
	handler   http.Handler
	log       *slog.Logger
	newRun    func(Options, *slog.Logger) runner
	media     Media
	onAddress func(ip string)

	mu      sync.Mutex
	base    context.Context // set by Run
	desired Settings
	cur     *instance // the wanted node, nil when disabled
	prev    *instance // the last node told to stop
}

// oldNodeWait bounds how long a new node waits for the old one to release
// the state dir.
const oldNodeWait = 15 * time.Second

type instance struct {
	settings Settings
	cancel   context.CancelFunc
	done     chan struct{}

	mu      sync.Mutex
	run     runner // nil while the node is down
	lastErr string
}

func (inst *instance) setRun(run runner, err error) {
	inst.mu.Lock()
	defer inst.mu.Unlock()
	inst.run = run
	if err != nil {
		inst.lastErr = err.Error()
	} else if run != nil {
		inst.lastErr = ""
	}
}

func (inst *instance) current() (runner, string) {
	inst.mu.Lock()
	defer inst.mu.Unlock()
	return inst.run, inst.lastErr
}

func NewManager(stateDir string, handler http.Handler, log *slog.Logger) *Manager {
	return &Manager{
		stateDir: stateDir, handler: handler, log: log,
		newRun: func(o Options, l *slog.Logger) runner { return New(o, l) },
	}
}

func (m *Manager) UseMedia(media Media) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.media = media
}

func (m *Manager) UseAddressHook(fn func(ip string)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onAddress = fn
}

// Run applies the desired settings and keeps the node reconciled until ctx
// is done, then stops it.
func (m *Manager) Run(ctx context.Context) {
	m.mu.Lock()
	m.base = ctx
	m.reconcileLocked()
	m.mu.Unlock()
	<-ctx.Done()
	m.mu.Lock()
	m.stopLocked()
	last := m.prev
	m.mu.Unlock()
	if last != nil {
		waitStopped(last, m.log)
	}
}

// Apply records the settings in force and reconciles the node with them
// (once Run has started).
func (m *Manager) Apply(settings Settings) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.desired = settings
	if m.base != nil && m.base.Err() == nil {
		m.reconcileLocked()
	}
}

func (m *Manager) reconcileLocked() {
	want := m.desired
	if want.Enabled && want.Hostname == "" {
		want.Hostname = "stoop"
	}
	if m.cur != nil {
		if want.Enabled && m.cur.settings == want {
			return
		}
		m.stopLocked()
	}
	if !want.Enabled {
		return
	}
	ctx, cancel := context.WithCancel(m.base)
	opts := Options{
		Hostname: want.Hostname, AuthKey: want.AuthKey, ControlURL: want.ControlURL,
		StateDir: m.stateDir, Funnel: want.Funnel, Media: m.media,
		OnAddress: m.onAddress,
	}
	first := m.newRun(opts, m.log)
	inst := &instance{settings: want, cancel: cancel, done: make(chan struct{})}
	old := m.prev
	m.cur = inst
	go func() {
		defer close(inst.done)
		// Both nodes use one state dir, so the old one goes first.
		if old != nil {
			waitStopped(old, m.log)
		}
		restart.Loop(ctx, m.log, "tailscale: node stopped; restarting", func(ctx context.Context) error {
			run := first
			if run == nil {
				run = m.newRun(opts, m.log)
			}
			first = nil
			inst.setRun(run, nil)
			err := run.Serve(ctx, m.handler)
			if err == nil {
				err = errors.New("tailscale: node stopped")
			}
			inst.setRun(nil, err)
			return err
		})
	}()
}

// stopLocked tells the wanted node to stop without waiting for it; the
// next node and Run's exit wait instead.
func (m *Manager) stopLocked() {
	if m.cur == nil {
		return
	}
	m.cur.cancel()
	m.prev = m.cur
	m.cur = nil
}

func waitStopped(inst *instance, log *slog.Logger) {
	select {
	case <-inst.done:
	case <-time.After(oldNodeWait):
		log.Warn("tailscale: listener did not stop in time")
	}
}

// PublicURL is the running node's https address, or "".
func (m *Manager) PublicURL() string {
	m.mu.Lock()
	cur := m.cur
	m.mu.Unlock()
	if cur == nil {
		return ""
	}
	run, _ := cur.current()
	if run == nil {
		return ""
	}
	return run.PublicURL()
}

// Status reports the node's state; Enabled is false when nothing is
// wanted. A wanted node that is down reports "starting" with the reason.
func (m *Manager) Status(ctx context.Context) (Status, bool) {
	m.mu.Lock()
	cur := m.cur
	m.mu.Unlock()
	if cur == nil {
		return Status{State: "stopped"}, false
	}
	run, lastErr := cur.current()
	if run == nil {
		return Status{State: "starting", Funnel: cur.settings.Funnel, Error: lastErr}, true
	}
	return run.Status(ctx), true
}
