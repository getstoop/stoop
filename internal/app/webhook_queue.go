package app

import (
	"context"
	"sync"
	"time"

	"github.com/getstoop/stoop/internal/instance"
	"github.com/getstoop/stoop/internal/integrations"
)

// The outgoing queue, counted only when someone asks: the Health row,
// the Background work panel and a metrics scrape share one answer, cached
// so a tab polling every five seconds costs Postgres one count per TTL.
// It is deliberately not a sampled gauge, so nothing runs the query while
// no one is looking.

const queueStatsTTL = 10 * time.Second

type queueStats struct {
	read func(ctx context.Context) (instance.QueueStats, error)

	mu   sync.Mutex
	at   time.Time
	last instance.QueueStats
	err  error
}

// webhookQueue adapts integrations.QueueStats to the instance port.
func webhookQueue(hooks *integrations.Service) *queueStats {
	return &queueStats{read: func(ctx context.Context) (instance.QueueStats, error) {
		q, err := hooks.QueueStats(ctx)
		return instance.QueueStats{
			Queued: q.Queued, Leased: q.Leased, Dead: q.Dead,
			DeadLastHour: q.DeadLastHour, Hooks: q.Hooks,
		}, err
	}}
}

// stats answers from the cache while it is fresh.
func (c *queueStats) stats(ctx context.Context) (instance.QueueStats, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Since(c.at) < queueStatsTTL {
		return c.last, c.err
	}
	c.last, c.err = c.read(ctx)
	c.at = time.Now()
	return c.last, c.err
}
