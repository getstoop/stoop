package jobs

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/dbgen"
)

func TestStaleAttemptWritesChangeNothing(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	ctx := context.Background()
	service, registry := newTestService(pool, clock, testConfig())
	Register(registry, "noop", func(context.Context, *Job, NoArgs) error { return nil }, Options{})
	id := mustEnqueue(t, service, "noop", nil)

	leaseUntil := clock.Now().Add(10 * time.Minute)
	leased, err := service.queries.LeaseJobs(ctx, dbgen.LeaseJobsParams{Until: leaseUntil, Now: clock.Now(), Kinds: []string{"noop"}, Limit: 1})
	if err != nil || len(leased) != 1 || leased[0].Attempt != 1 {
		t.Fatalf("lease = %+v, %v", leased, err)
	}
	stale := leased[0]
	// The row moves on to a second attempt behind the stale worker's back.
	if _, err := pool.Exec(ctx, `UPDATE jobs SET attempt = 2 WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}

	job := service.newJob(stale)
	if err := job.Extend(ctx, time.Hour); err != nil {
		t.Fatal(err)
	}
	expectUnchanged := func(what string) {
		t.Helper()
		row := readJob(t, pool, id)
		if row.State != string(StateRunning) || row.Attempt != 2 || row.FinishedAt != nil || row.Error != "" {
			t.Errorf("%s changed the row: %+v", what, row)
		}
		sameInstant(t, what+" leased_until", row.LeasedUntil, leaseUntil)
	}
	expectUnchanged("stale Extend")
	opts := Options{}.withDefaults()
	if err := service.writeOutcome(ctx, stale, job, opts, nil); err != nil {
		t.Fatal(err)
	}
	expectUnchanged("stale success")
	if err := service.writeOutcome(ctx, stale, job, opts, errors.New("late failure")); err != nil {
		t.Fatal(err)
	}
	expectUnchanged("stale failure")
	if err := service.writeOutcome(ctx, stale, job, opts, Discard(errors.New("late discard"))); err != nil {
		t.Fatal(err)
	}
	expectUnchanged("stale discard")
}
