package app

import (
	"context"
	"sync"
	"time"

	"github.com/Jhut89/stoop/internal/config"
	"github.com/Jhut89/stoop/internal/instance"
	"github.com/Jhut89/stoop/internal/voice"
)

// Whether the voice sidecar is up. Stoop doesn't run LiveKit, so dialling
// it is the only way to know.

// reachableTTL caches the check. The admin page can poll while an
// operator is fixing something, and a sidecar's state doesn't move
// faster than this.
const reachableTTL = 2 * time.Second

type liveKitReporter struct {
	opts  voice.Options
	url   string
	alive func(ctx context.Context) bool

	mu       sync.Mutex
	lastAt   time.Time
	lastSeen bool
}

func newLiveKitReporter(cfg config.Config, opts voice.Options) *liveKitReporter {
	return &liveKitReporter{opts: opts, url: cfg.LiveKitURL, alive: liveKitProbe(cfg.LiveKitURL)}
}

func (r *liveKitReporter) reachable(ctx context.Context) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if time.Since(r.lastAt) < reachableTTL {
		return r.lastSeen
	}
	r.lastAt, r.lastSeen = time.Now(), r.alive != nil && r.alive(ctx)
	return r.lastSeen
}

func (r *liveKitReporter) LiveKitStatus(ctx context.Context) instance.LiveKitStatus {
	if !r.opts.Enabled() {
		return instance.LiveKitStatus{}
	}
	return instance.LiveKitStatus{Running: r.reachable(ctx), URL: r.url}
}
