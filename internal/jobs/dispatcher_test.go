package jobs

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

func TestTwoDispatchersPerformEachJobOnce(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	var mu sync.Mutex
	performed := map[string]int{}
	count := func(_ context.Context, job *Job, _ NoArgs) error {
		mu.Lock()
		performed[job.ID]++
		mu.Unlock()
		time.Sleep(time.Millisecond)
		return nil
	}
	first, firstRegistry := newTestService(pool, clock, testConfig())
	Register(firstRegistry, "count", count, Options{})
	second, secondRegistry := newTestService(pool, clock, testConfig())
	Register(secondRegistry, "count", count, Options{})

	const total = 50
	ids := make([]string, 0, total)
	for range total {
		ids = append(ids, mustEnqueue(t, first, "count", nil))
	}
	stopFirst := startDispatcher(t, first)
	stopSecond := startDispatcher(t, second)
	waitFor(t, "every job to succeed", func() bool {
		return countRows(t, pool, `SELECT count(*) FROM jobs WHERE kind = 'count' AND state = 'succeeded'`) == total
	})
	stopFirst()
	stopSecond()

	mu.Lock()
	defer mu.Unlock()
	for _, id := range ids {
		if performed[id] != 1 {
			t.Errorf("job %s performed %d times", id, performed[id])
		}
	}
	if len(performed) != total {
		t.Errorf("performed %d distinct jobs, want %d", len(performed), total)
	}
}

func TestShutdownReleasesInFlightRows(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	cfg := testConfig()
	cfg.ShutdownGrace = 200 * time.Millisecond
	service, registry := newTestService(pool, clock, cfg)
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	Register(registry, "blocks", func(context.Context, *Job, NoArgs) error {
		<-release
		return nil
	}, Options{})

	id := mustEnqueue(t, service, "blocks", nil)
	stop := startDispatcher(t, service)
	waitForState(t, pool, id, StateRunning, 1)
	if countRows(t, pool, `SELECT count(*) FROM job_dispatchers`) != 1 {
		t.Error("no heartbeat row while running")
	}

	// The performer ignores its context, so shutdown abandons it after the
	// grace and the bounded wait for the workers.
	took := stop()
	if took > cfg.ShutdownGrace+outcomeTimeout+3*time.Second {
		t.Errorf("RunDispatcher took %v to return after cancel", took)
	}
	row := readJob(t, pool, id)
	if row.State != string(StateQueued) || row.LeasedUntil != nil || row.Attempt != 1 {
		t.Errorf("after shutdown: state %s leased_until %v attempt %d", row.State, row.LeasedUntil, row.Attempt)
	}
	if countRows(t, pool, `SELECT count(*) FROM job_dispatchers`) != 0 {
		t.Error("heartbeat row left behind")
	}
}

func TestPanicIsAFailureAndRetried(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	service, registry := newTestService(pool, clock, testConfig())
	Register(registry, "panics", func(context.Context, *Job, NoArgs) error {
		panic("kaboom")
	}, Options{})

	id := mustEnqueue(t, service, "panics", nil)
	startDispatcher(t, service)
	row := waitForState(t, pool, id, StateQueued, 1)
	if !strings.HasPrefix(row.Error, "panic: ") || !strings.Contains(row.Error, "kaboom") {
		t.Errorf("error = %q, want a panic", row.Error)
	}
	clock.Advance(DefaultBackoff[0] + time.Second)
	waitForState(t, pool, id, StateQueued, 2)
}

func TestSlowPerformerKeepsItsLease(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	service, registry := newTestService(pool, clock, testConfig())
	var performed atomic.Int32
	release := make(chan struct{})
	Register(registry, "slow", func(context.Context, *Job, NoArgs) error {
		performed.Add(1)
		<-release
		return nil
	}, Options{Lease: time.Second})

	id := mustEnqueue(t, service, "slow", nil)
	startDispatcher(t, service)
	waitForState(t, pool, id, StateRunning, 1)

	// Each step moves the clock most of a lease; the renewal lands before
	// the next step, so the lease never lapses though the run outlives it.
	for range 3 {
		waitFor(t, "the lease to be renewed", func() bool {
			row := readJob(t, pool, id)
			return row.LeasedUntil != nil && row.LeasedUntil.Equal(clock.Now().Add(time.Second))
		})
		clock.Advance(700 * time.Millisecond)
	}
	time.Sleep(5 * testConfig().Poll)
	if row := readJob(t, pool, id); row.Attempt != 1 || row.State != string(StateRunning) {
		t.Fatalf("re-leased: attempt %d state %s", row.Attempt, row.State)
	}
	close(release)
	waitForState(t, pool, id, StateSucceeded, 1)
	if performed.Load() != 1 {
		t.Errorf("performed %d times", performed.Load())
	}
}

func TestLapsedLeasePastMaxAttemptsIsDiscarded(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	service, registry := newTestService(pool, clock, testConfig())
	var performed atomic.Int32
	Register(registry, "spent", func(context.Context, *Job, NoArgs) error {
		performed.Add(1)
		return nil
	}, Options{})
	const id = "00000000-0000-7000-8000-000000000021"
	_, err := pool.Exec(context.Background(), `INSERT INTO jobs (id, kind, state, attempt, max_attempts, not_before, created_at)
		VALUES ($1, 'spent', 'queued', 4, 4, $2, $2)`, id, clock.Now().Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}

	startDispatcher(t, service)
	row := waitForState(t, pool, id, StateDiscarded, 5)
	if row.Error != lapsedLeaseError || row.LeasedUntil != nil {
		t.Errorf("discarded row: error %q leased_until %v", row.Error, row.LeasedUntil)
	}
	if performed.Load() != 0 {
		t.Errorf("performer ran %d times", performed.Load())
	}
}

func TestShutdownWaitsForCancelledWorkers(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	cfg := testConfig()
	cfg.ShutdownGrace = 200 * time.Millisecond
	service, registry := newTestService(pool, clock, cfg)
	Register(registry, "obeys", func(ctx context.Context, _ *Job, _ NoArgs) error {
		<-ctx.Done()
		return ctx.Err()
	}, Options{})

	id := mustEnqueue(t, service, "obeys", nil)
	stop := startDispatcher(t, service)
	waitForState(t, pool, id, StateRunning, 1)
	took := stop()
	if took > cfg.ShutdownGrace+outcomeTimeout {
		t.Errorf("RunDispatcher took %v to return after cancel", took)
	}
	row := readJob(t, pool, id)
	if row.State != string(StateQueued) || row.LeasedUntil != nil || row.Attempt != 1 {
		t.Errorf("after shutdown: state %s leased_until %v attempt %d", row.State, row.LeasedUntil, row.Attempt)
	}
}
