package eventrelay

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/restart"
)

const closeTimeout = time.Second

// Listener holds one connection outside the pool on Channel and
// publishes each notification it carries on bus, as the topic and event
// the other process published.
type Listener struct {
	bus  events.Bus
	pool *pgxpool.Pool
	log  *slog.Logger
	// listening, when set by a test, is called after each LISTEN succeeds.
	listening func()
}

// NewListener builds a Listener that republishes on bus what arrives on
// Channel through a connection made from pool's configuration.
func NewListener(bus events.Bus, pool *pgxpool.Pool, log *slog.Logger) *Listener {
	return &Listener{bus: bus, pool: pool, log: log}
}

// Run listens until ctx ends, reconnecting with backoff after any
// failure. A notification raised while it is reconnecting is lost.
func (l *Listener) Run(ctx context.Context) {
	restart.Loop(ctx, l.log, "events: relay listener stopped; retrying", l.runOnce)
}

// runOnce connects, listens and republishes until the connection fails
// or ctx ends; the connection is closed either way.
func (l *Listener) runOnce(ctx context.Context) error {
	conn, err := pgx.ConnectConfig(ctx, l.pool.Config().ConnConfig.Copy())
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), closeTimeout)
		defer cancel()
		_ = conn.Close(closeCtx)
	}()
	if _, err := conn.Exec(ctx, "LISTEN "+pgx.Identifier{Channel}.Sanitize()); err != nil {
		return err
	}
	if l.listening != nil {
		l.listening()
	}
	pieces := newAssembler()
	for {
		notification, err := conn.WaitForNotification(ctx)
		if err != nil {
			return err
		}
		p, err := decodePayload(notification.Payload)
		if err != nil {
			l.log.Warn("events: relayed event unreadable; dropped", "err", err)
			continue
		}
		ev, err := pieces.add(p)
		if err != nil {
			l.log.Warn("events: relayed event unreadable; dropped", "topic", p.topic, "err", err)
			continue
		}
		if ev != nil {
			l.bus.Publish(p.topic, ev)
		}
	}
}
