package app

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/integrations"
	"github.com/getstoop/stoop/internal/jobs"
)

type outgoingOn struct{}

func (outgoingOn) WebhooksIncoming(context.Context) (bool, error)            { return false, nil }
func (outgoingOn) WebhooksOutgoing(context.Context) (bool, error)            { return true, nil }
func (outgoingOn) WebhooksAllowPrivateTargets(context.Context) (bool, error) { return false, nil }
func (outgoingOn) PublicURL(context.Context) (string, error)                 { return "", nil }

// A delivery whose hook can't be read is handed back, not tried: it is
// still queued, its limit raised each time, after more failures than its
// attempts.
func TestDeliveryWhoseHookCannotBeReadIsNotUsedUp(t *testing.T) {
	pool := dbtest.New(t)
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	hooksSvc := integrations.New(pool, events.NewInProcBus(), quiet)
	hooksSvc.UsePolicy(outgoingOn{})
	registry := jobs.NewRegistry()
	registerDeliveries(registry, hooksSvc, 1)
	runner := jobs.New(pool, registry, jobs.Config{Workers: 1, Poll: 20 * time.Millisecond, ShutdownGrace: time.Second, Host: "test"}, quiet)

	// A hook id Postgres refuses to parse: the lookup fails, not "no rows".
	id, err := runner.Enqueue(context.Background(), integrations.DeliverWebhookKind, integrations.DeliveryArgs{
		DeliveryID: "11111111-1111-4111-8111-111111111111", HookID: "not-a-uuid", Event: "message.created", Body: []byte(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() {
		runner.RunDispatcher(ctx)
		close(stopped)
	}()
	t.Cleanup(func() {
		cancel()
		<-stopped
	})

	queries := dbgen.New(pool)
	var lastStart time.Time
	for round := 1; round <= deliveryAttempts+2; round++ {
		deadline := time.Now().Add(10 * time.Second)
		var row dbgen.Job
		for {
			if row, err = queries.GetJob(context.Background(), id); err != nil {
				t.Fatal(err)
			}
			if row.StartedAt != nil && row.StartedAt.After(lastStart) && row.State != string(jobs.StateRunning) {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("round %d: the job was not tried (state %s)", round, row.State)
			}
			time.Sleep(10 * time.Millisecond)
		}
		if row.State != string(jobs.StateQueued) || row.MaxAttempts != int32(deliveryAttempts+round) {
			t.Fatalf("round %d: state %s attempt %d of %d (%s)", round, row.State, row.Attempt, row.MaxAttempts, row.Error)
		}
		lastStart = *row.StartedAt
		if _, err := pool.Exec(context.Background(), `UPDATE jobs SET not_before = $2 WHERE id = $1`, id, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
}

// Deliveries leave a quarter of the workers to everything else, and
// always get one.
func TestDeliverySlots(t *testing.T) {
	for workers, want := range map[int]int{1: 1, 2: 1, 4: 3, 16: 12} {
		if got := deliverySlots(workers); got != want {
			t.Errorf("deliverySlots(%d) = %d, want %d", workers, got, want)
		}
	}
}
