package app

import (
	"context"
	"sync"
	"time"

	"github.com/getstoop/stoop/internal/diag"
	"github.com/getstoop/stoop/internal/instance"
	"github.com/getstoop/stoop/internal/integrations"
)

// The outgoing queue, read once per sampler step at most: three gauges
// and the Health panel's webhooks row share one cached answer, so the
// diagnostics never cost Postgres more than one count every ten seconds.

const queueStatsTTL = diag.SampleStep

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

func (c *queueStats) gauge(pick func(instance.QueueStats) int64) func() float64 {
	return func() float64 {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		q, _ := c.stats(ctx)
		return float64(pick(q))
	}
}

func (c *queueStats) registerGauges() {
	diag.NewGauge("webhooks_queued", "Outgoing webhook deliveries waiting for the worker",
		c.gauge(func(q instance.QueueStats) int64 { return q.Queued }))
	diag.NewGauge("webhooks_leased", "Outgoing webhook deliveries in flight",
		c.gauge(func(q instance.QueueStats) int64 { return q.Leased }))
	diag.NewGauge("webhooks_dead", "Outgoing webhook deliveries dead-lettered",
		c.gauge(func(q instance.QueueStats) int64 { return q.Dead }))
}
