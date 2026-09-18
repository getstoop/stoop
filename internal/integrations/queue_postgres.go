package integrations

import (
	"cmp"
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/dbgen"
)

// PostgresQueue is the v1 Queue: webhook_deliveries with leases and
// SKIP LOCKED. See docs/architecture/integrations.md → The queue.
type PostgresQueue struct {
	q   *dbgen.Queries
	now func() time.Time
}

func NewPostgresQueue(pool *pgxpool.Pool) *PostgresQueue {
	return &PostgresQueue{q: dbgen.New(pool), now: time.Now}
}

func (p *PostgresQueue) Enqueue(ctx context.Context, it Item) error {
	notBefore := it.NotBefore
	if notBefore.IsZero() {
		notBefore = p.now()
	}
	if err := p.q.EnqueueDelivery(ctx, dbgen.EnqueueDeliveryParams{
		ID: it.ID, Lane: it.Lane, EventType: it.Event, Sequence: int64(it.Sequence), Body: it.Body, NotBefore: notBefore, Now: p.now(),
	}); err != nil {
		return fmt.Errorf("enqueue delivery: %w", err)
	}
	return nil
}

func (p *PostgresQueue) Lease(ctx context.Context, n int, until time.Duration) ([]Leased, error) {
	now := p.now()
	rows, err := p.q.LeaseDeliveries(ctx, dbgen.LeaseDeliveriesParams{Until: now.Add(until), Now: now, Limit: int32(n)})
	if err != nil {
		return nil, fmt.Errorf("lease deliveries: %w", err)
	}
	out := make([]Leased, len(rows))
	for i, r := range rows {
		out[i] = Leased{
			Item:    Item{ID: r.ID, Lane: r.Lane, Event: r.EventType, Sequence: uint64(r.Sequence), Body: r.Body, NotBefore: r.NotBefore},
			Attempt: int(r.Attempts),
		}
	}
	// RETURNING keeps no order; oldest first is part of the contract.
	slices.SortFunc(out, func(a, b Leased) int {
		if c := a.NotBefore.Compare(b.NotBefore); c != 0 {
			return c
		}
		return cmp.Compare(a.Sequence, b.Sequence)
	})
	return out, nil
}

func (p *PostgresQueue) Ack(ctx context.Context, id string, r Attempt) error {
	if err := p.q.AckDelivery(ctx, dbgen.AckDeliveryParams{ID: id, Now: p.now(), StatusCode: statusPtr(r.StatusCode), Response: r.Response}); err != nil {
		return fmt.Errorf("ack delivery: %w", err)
	}
	return nil
}

func (p *PostgresQueue) Nack(ctx context.Context, id string, retryAfter time.Duration, r Attempt) error {
	if err := p.q.NackDelivery(ctx, dbgen.NackDeliveryParams{
		ID: id, NotBefore: p.now().Add(retryAfter), StatusCode: statusPtr(r.StatusCode), Response: r.Response, Error: r.Error,
	}); err != nil {
		return fmt.Errorf("nack delivery: %w", err)
	}
	return nil
}

func (p *PostgresQueue) Dead(ctx context.Context, id string, r Attempt) error {
	if err := p.q.DeadDelivery(ctx, dbgen.DeadDeliveryParams{ID: id, Now: p.now(), StatusCode: statusPtr(r.StatusCode), Response: r.Response, Error: r.Error}); err != nil {
		return fmt.Errorf("dead-letter delivery: %w", err)
	}
	return nil
}

func statusPtr(code int) *int32 {
	if code == 0 {
		return nil
	}
	c := int32(code)
	return &c
}
