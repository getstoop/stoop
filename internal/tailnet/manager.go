package tailnet

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"
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

// Manager owns at most one running node and reconciles it with the
// settings in force: Apply starts, stops, or restarts it as needed, and
// settings applied before Run are honoured once Run starts. The node
// identity lives in the state dir, so a restart keeps the same device.
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
	cur     *instance
}

type instance struct {
	settings Settings
	run      runner
	cancel   context.CancelFunc
	done     chan struct{}
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
	m.mu.Unlock()
}

// Apply records the settings in force and reconciles the node with them
// (once Run has started).
func (m *Manager) Apply(s Settings) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.desired = s
	if m.base != nil {
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
	run := m.newRun(Options{
		Hostname: want.Hostname, AuthKey: want.AuthKey, ControlURL: want.ControlURL,
		StateDir: m.stateDir, Funnel: want.Funnel, Media: m.media,
		OnAddress: m.onAddress,
	}, m.log)
	inst := &instance{settings: want, run: run, cancel: cancel, done: make(chan struct{})}
	m.cur = inst
	go func() {
		defer close(inst.done)
		if err := run.Serve(ctx, m.handler); err != nil && ctx.Err() == nil {
			m.log.Error("tailscale: listener stopped", "err", err)
		}
	}()
}

func (m *Manager) stopLocked() {
	if m.cur == nil {
		return
	}
	m.cur.cancel()
	select {
	case <-m.cur.done:
	case <-time.After(15 * time.Second):
		m.log.Warn("tailscale: listener did not stop in time")
	}
	m.cur = nil
}

// PublicURL is the running node's https address, or "".
func (m *Manager) PublicURL() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cur == nil {
		return ""
	}
	return m.cur.run.PublicURL()
}

// Status reports the node's state; Enabled is false when nothing runs.
func (m *Manager) Status(ctx context.Context) (Status, bool) {
	m.mu.Lock()
	cur := m.cur
	m.mu.Unlock()
	if cur == nil {
		return Status{State: "stopped"}, false
	}
	return cur.run.Status(ctx), true
}
