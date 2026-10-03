package app

import (
	"context"
	"sync"
	"time"

	"github.com/getstoop/stoop/internal/instance"
	"github.com/getstoop/stoop/internal/integrations"
	"github.com/getstoop/stoop/internal/jobs"
)

// The outgoing deliveries, counted only when someone asks: the Health
// row, the Background work panel and a metrics scrape share one answer,
// cached so a tab polling every five seconds costs Postgres one count
// per TTL. It is deliberately not a sampled gauge, so nothing runs the
// queries while no one is looking.

const queueStatsTTL = 10 * time.Second

type queueStats struct {
	read func(ctx context.Context) (instance.QueueStats, error)

	mu   sync.Mutex
	at   time.Time
	last instance.QueueStats
	err  error
}

// webhookQueue answers the instance port from two readers: the backlog
// of deliver_webhook jobs and the delivery log.
func webhookQueue(jobsSvc *jobs.Service, hooks *integrations.Service) *queueStats {
	return &queueStats{read: func(ctx context.Context) (instance.QueueStats, error) {
		backlog, err := jobsSvc.Backlog(ctx, integrations.DeliverWebhookKind)
		if err != nil {
			return instance.QueueStats{}, err
		}
		log, err := hooks.DeliveryStats(ctx)
		if err != nil {
			return instance.QueueStats{}, err
		}
		return instance.QueueStats{
			Queued: backlog.Queued, Leased: backlog.Running, OldestDue: backlog.OldestDue,
			Dead: log.Dead, DeadLastHour: log.DeadLastHour, Hooks: log.Hooks,
		}, nil
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
