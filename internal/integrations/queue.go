package integrations

import (
	"context"
	"time"
)

// Item is one delivery to make: self-contained, so a backend never joins
// against another table.
type Item struct {
	// ID is a UUIDv7, the Stoop-Delivery header, stable across attempts.
	ID string
	// Lane is the hook id: ordering and one-in-flight scope.
	Lane     string
	Event    string
	Sequence uint64
	Body     []byte
	// NotBefore delays the first attempt.
	NotBefore time.Time
}

// Leased is an item claimed by a worker.
type Leased struct {
	Item
	Attempt int
}

// Attempt is what a worker learned from one try.
type Attempt struct {
	StatusCode int
	Response   string
	Error      string
}

// Queue is the delivery queue port. Postgres implements it today; any
// backend with a lease, an ack and a delayed nack can. See
// docs/architecture/integrations.md → The queue.
type Queue interface {
	Enqueue(ctx context.Context, it Item) error
	// Lease hands out up to n due items, invisible to other workers until
	// the deadline, at most one in flight per lane. The deadline must
	// exceed the longest attempt or an item goes out twice.
	Lease(ctx context.Context, n int, until time.Duration) ([]Leased, error)
	Ack(ctx context.Context, id string, r Attempt) error
	// Nack releases the item for another try after retryAfter.
	Nack(ctx context.Context, id string, retryAfter time.Duration, r Attempt) error
	// Dead finishes the item without delivering it.
	Dead(ctx context.Context, id string, r Attempt) error
}
