package eventrelay

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/events"
)

// notifyTimeout bounds the round trip a publish spends raising its
// notification.
const notifyTimeout = 5 * time.Second

// Publisher is an events.Bus whose every Publish also reaches the
// process listening on Channel. Subscriptions are the wrapped bus's own.
type Publisher struct {
	bus  events.Bus
	pool *pgxpool.Pool
	log  *slog.Logger
}

// NewPublisher wraps bus so that what is published on it is also
// notified on Channel through pool.
func NewPublisher(bus events.Bus, pool *pgxpool.Pool, log *slog.Logger) *Publisher {
	return &Publisher{bus: bus, pool: pool, log: log}
}

// Publish delivers to the wrapped bus, then notifies. An event too large
// for NOTIFY is delivered locally and dropped from the relay with a
// warning; so is one the notification fails for.
func (p *Publisher) Publish(topic string, ev *realtimev1.ServerEvent) {
	p.bus.Publish(topic, ev)
	payload, err := encode(topic, ev)
	if err != nil {
		p.log.Warn("events: not relayed; dropped", "topic", topic, "event_id", ev.GetEventId(), "err", err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), notifyTimeout)
	defer cancel()
	if _, err := p.pool.Exec(ctx, "SELECT pg_notify($1, $2)", Channel, payload); err != nil {
		p.log.Warn("events: not relayed; dropped", "topic", topic, "event_id", ev.GetEventId(), "err", err)
	}
}

// Subscribe is the wrapped bus's Subscribe.
func (p *Publisher) Subscribe(topics ...string) *events.Subscription {
	return p.bus.Subscribe(topics...)
}
