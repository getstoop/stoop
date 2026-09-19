package integrations

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/dbgen"
)

// One row in each state the panel distinguishes: waiting, waiting behind
// an expired lease, leased, delivered, dead-lettered now and dead-lettered
// long ago.
func TestQueueStats(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	userID, spaceID, lane := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, q := range []string{
		`INSERT INTO users (id, username, display_name, role) VALUES ('` + userID + `', 'casey', 'Casey', 'admin')`,
		`INSERT INTO spaces (id, name, owner_id) VALUES ('` + spaceID + `', 'Porch', '` + userID + `')`,
		`INSERT INTO outgoing_webhooks (id, space_id, url, secret, event_types, name, created_by) VALUES ('` + lane + `', '` + spaceID + `', 'https://a.example', 'x', '{}', 'a', '` + userID + `')`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	svc := New(pool, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	clock := time.Now()
	svc.now = func() time.Time { return clock }

	if got, err := svc.QueueStats(ctx); err != nil || got != (QueueStats{Hooks: 1}) {
		t.Fatalf("empty queue = %+v, %v", got, err)
	}

	q := dbgen.New(pool)
	seq := int64(0)
	add := func(t *testing.T) string {
		seq++
		id := newID()
		if err := q.EnqueueDelivery(ctx, dbgen.EnqueueDeliveryParams{
			ID: id, Lane: lane, EventType: "message.created", Sequence: seq, Body: []byte("{}"), NotBefore: clock, Now: clock,
		}); err != nil {
			t.Fatal(err)
		}
		return id
	}
	waiting, expiredLease, leased := add(t), add(t), add(t)
	delivered, deadNow, deadOld := add(t), add(t), add(t)
	status := func(code int32) *int32 { return &code }
	lease := `UPDATE webhook_deliveries SET leased_until = $2, attempts = 1 WHERE id = $1`
	if _, err := pool.Exec(ctx, lease, expiredLease, clock.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, lease, leased, clock.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	for name, err := range map[string]error{
		"ack":      q.AckDelivery(ctx, dbgen.AckDeliveryParams{ID: delivered, Now: clock, StatusCode: status(200)}),
		"dead now": q.DeadDelivery(ctx, dbgen.DeadDeliveryParams{ID: deadNow, Now: clock.Add(-time.Minute), StatusCode: status(500), Error: "500"}),
		"dead old": q.DeadDelivery(ctx, dbgen.DeadDeliveryParams{ID: deadOld, Now: clock.Add(-2 * time.Hour), Error: "dial tcp: refused"}),
	} {
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	_ = waiting

	got, err := svc.QueueStats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	want := QueueStats{Queued: 2, Leased: 1, Dead: 2, DeadLastHour: 1, Hooks: 1}
	if got != want {
		t.Errorf("stats = %+v, want %+v", got, want)
	}
}
