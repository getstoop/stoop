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
	"github.com/getstoop/stoop/internal/rowid"
)

// One row in each state the panel distinguishes: pending, delivered,
// dead-lettered now and dead-lettered long ago.
func TestDeliveryStats(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	userID, spaceID, hookID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, statement := range []string{
		`INSERT INTO users (id, username, display_name, role) VALUES ('` + userID + `', 'casey', 'Casey', 'admin')`,
		`INSERT INTO spaces (id, name, owner_id) VALUES ('` + spaceID + `', 'Porch', '` + userID + `')`,
		`INSERT INTO outgoing_webhooks (id, space_id, url, secret, event_types, name, created_by) VALUES ('` + hookID + `', '` + spaceID + `', 'https://a.example', 'x', '{}', 'a', '` + userID + `')`,
	} {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	svc := New(pool, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	clock := time.Now()
	svc.now = func() time.Time { return clock }

	if got, err := svc.DeliveryStats(ctx); err != nil || got != (DeliveryStats{Hooks: 1}) {
		t.Fatalf("empty log = %+v, %v", got, err)
	}

	queries := dbgen.New(pool)
	sequence := int64(0)
	insert := func(t *testing.T) string {
		sequence++
		id := rowid.New()
		if err := queries.InsertDelivery(ctx, dbgen.InsertDeliveryParams{
			ID: id, WebhookID: hookID, EventType: "message.created", Sequence: sequence, Body: []byte("{}"), Now: clock,
		}); err != nil {
			t.Fatal(err)
		}
		return id
	}
	record := func(t *testing.T, id string, code int32, finishedAt time.Time, delivered bool) {
		if err := queries.RecordDeliveryAttempt(ctx, dbgen.RecordDeliveryAttemptParams{
			ID: id, Attempts: 1, StatusCode: &code, FinishedAt: &finishedAt, Delivered: delivered,
		}); err != nil {
			t.Fatal(err)
		}
	}
	insert(t)
	record(t, insert(t), 200, clock, true)
	record(t, insert(t), 500, clock.Add(-time.Minute), false)
	record(t, insert(t), 503, clock.Add(-2*time.Hour), false)

	got, err := svc.DeliveryStats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if want := (DeliveryStats{Dead: 2, DeadLastHour: 1, Hooks: 1}); got != want {
		t.Errorf("stats = %+v, want %+v", got, want)
	}
}
