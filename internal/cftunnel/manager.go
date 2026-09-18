// Package cftunnel runs Cloudflare's connector (cloudflared) as a child
// process, so a Cloudflare Tunnel can be switched on from the admin page.
// It is one optional front door among several, like internal/tailnet: the
// plain listener always runs, and cloudflared forwards to it over
// loopback. See docs/proposals/cloudflare-tunnel.md.
package cftunnel

import (
	"context"
	"log/slog"
	"os/exec"
	"sync"
	"time"
)

// Settings is what the operator controls at runtime.
type Settings struct {
	Enabled bool
	Token   string
}

// Status is what the setup wizard and admin page show.
type Status struct {
	State string // stopped, missing, starting, running, error
	Error string
}

// runner is a Connector, or a fake in tests.
type runner interface {
	Run(ctx context.Context)
	Status() Status
}

// Manager owns at most one running connector and reconciles it with the
// settings in force, the way tailnet.Manager does its node.
type Manager struct {
	path   string
	log    *slog.Logger
	newRun func(Options, *slog.Logger) runner

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

// NewManager takes where cloudflared is ("" looks on PATH).
func NewManager(path string, log *slog.Logger) *Manager {
	return &Manager{
		path: path, log: log,
		newRun: func(o Options, l *slog.Logger) runner { return New(o, l) },
	}
}

// Run applies the desired settings and keeps the connector reconciled
// until ctx is done, then stops it.
func (m *Manager) Run(ctx context.Context) {
	m.mu.Lock()
	m.base = ctx
	m.reconcileLocked()
	m.mu.Unlock()
	<-ctx.Done()
	m.mu.Lock()
	cur := m.stopLocked()
	m.mu.Unlock()
	if cur == nil {
		return
	}
	select {
	case <-cur.done:
	case <-time.After(15 * time.Second):
		m.log.Warn("cloudflare tunnel: connector did not stop in time")
	}
}

// Apply records the settings in force and reconciles the connector with
// them (once Run has started). It returns as soon as the change is under
// way: a connector on its way out winds down on its own, and nothing
// waits on it, so a status read never blocks on cloudflared's exit.
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
	if want.Token == "" {
		want.Enabled = false
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
	run := m.newRun(Options{Path: m.path, Token: want.Token}, m.log)
	inst := &instance{settings: want, run: run, cancel: cancel, done: make(chan struct{})}
	m.cur = inst
	go func() {
		defer close(inst.done)
		run.Run(ctx)
	}()
}

// stopLocked tells the current connector to stop and forgets it; the
// caller may wait on the returned instance's done.
func (m *Manager) stopLocked() *instance {
	cur := m.cur
	if cur != nil {
		cur.cancel()
		m.cur = nil
	}
	return cur
}

// Status reports the connector's state; the bool is false when nothing
// runs, and the state then says whether cloudflared is there to run.
func (m *Manager) Status() (Status, bool) {
	m.mu.Lock()
	cur := m.cur
	m.mu.Unlock()
	if cur == nil {
		if _, err := lookPath(m.path); err != nil {
			return Status{State: "missing"}, false
		}
		return Status{State: "stopped"}, false
	}
	return cur.run.Status(), true
}

func lookPath(path string) (string, error) {
	if path == "" {
		path = "cloudflared"
	}
	return exec.LookPath(path)
}
