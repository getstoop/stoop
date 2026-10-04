package jobs

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/restart"
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
	expectWithinShutdownBudget(t, cfg, stop())
	expectReleased(t, pool, id)
	if countRows(t, pool, `SELECT count(*) FROM job_dispatchers`) != 0 {
		t.Error("heartbeat row left behind")
	}

	// The interrupted run cost no attempt: the next start runs it as the first.
	restarted, restartedRegistry := newTestService(pool, clock, cfg)
	attempts := make(chan int, 1)
	Register(restartedRegistry, "blocks", func(_ context.Context, job *Job, _ NoArgs) error {
		attempts <- job.Attempt
		return nil
	}, Options{})
	startDispatcher(t, restarted)
	waitForState(t, pool, id, StateSucceeded, 1)
	if got := <-attempts; got != 1 {
		t.Errorf("performed as attempt %d after a restart, want 1", got)
	}
}

// expectWithinShutdownBudget checks RunDispatcher came back after a cancel
// within the grace, the release writes and the wait for the workers.
func expectWithinShutdownBudget(t *testing.T, cfg Config, took time.Duration) {
	t.Helper()
	if budget := cfg.ShutdownGrace + releaseTimeout + leaveTimeout; took > budget {
		t.Errorf("RunDispatcher took %v to return after cancel, budget %v", took, budget)
	}
}

// expectReleased checks a row shutdown let go of: queued, unleased, and
// the interrupted attempt given back.
func expectReleased(t *testing.T, pool *pgxpool.Pool, id string) {
	t.Helper()
	row := readJob(t, pool, id)
	if row.State != string(StateQueued) || row.LeasedUntil != nil || row.Attempt != 0 {
		t.Errorf("after shutdown: state %s leased_until %v attempt %d", row.State, row.LeasedUntil, row.Attempt)
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
	service.lease = 400 * time.Millisecond
	var performed atomic.Int32
	extendNow, extended, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	Register(registry, "slow", func(ctx context.Context, job *Job, _ NoArgs) error {
		performed.Add(1)
		<-extendNow
		if err := job.Extend(ctx, 3*time.Hour); err != nil {
			return err
		}
		close(extended)
		<-release
		return nil
	}, Options{})

	id := mustEnqueue(t, service, "slow", nil)
	startDispatcher(t, service)
	waitForState(t, pool, id, StateRunning, 1)

	// Each step moves the clock most of a lease; the renewal lands before
	// the next step, so the lease never lapses though the run outlives it.
	for range 3 {
		waitFor(t, "the lease to be renewed", func() bool {
			row := readJob(t, pool, id)
			return row.LeasedUntil != nil && row.LeasedUntil.Equal(clock.Now().Add(service.lease))
		})
		clock.Advance(300 * time.Millisecond)
	}
	time.Sleep(5 * testConfig().Poll)
	if row := readJob(t, pool, id); row.Attempt != 1 || row.State != string(StateRunning) {
		t.Fatalf("re-leased: attempt %d state %s", row.Attempt, row.State)
	}

	// An explicit Extend outlives the renewals that follow it.
	close(extendNow)
	<-extended
	time.Sleep(3 * service.lease)
	sameInstant(t, "leased_until after Extend and renewals", readJob(t, pool, id).LeasedUntil, clock.Now().Add(3*time.Hour))
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
	expectWithinShutdownBudget(t, cfg, stop())
	expectReleased(t, pool, id)
}

func TestLapsedLeaseIsNotReleasedInProcess(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	service, registry := newTestService(pool, clock, testConfig())
	var performed atomic.Int32
	release := make(chan struct{})
	Register(registry, "lapses", func(context.Context, *Job, NoArgs) error {
		performed.Add(1)
		<-release
		return nil
	}, Options{})

	id := mustEnqueue(t, service, "lapses", nil)
	startDispatcher(t, service)
	waitForState(t, pool, id, StateRunning, 1)

	// The lease lapses under a performer this dispatcher is still running
	// (renewals missed, or the clock jumping); it must not claim the row again.
	clock.Advance(service.lease + time.Second)
	time.Sleep(5 * testConfig().Poll)
	row := readJob(t, pool, id)
	if row.State != string(StateRunning) || row.Attempt != 1 {
		t.Fatalf("re-leased in process: state %s attempt %d", row.State, row.Attempt)
	}
	if performed.Load() != 1 {
		t.Fatalf("performer ran %d times", performed.Load())
	}
	close(release)
	waitForState(t, pool, id, StateSucceeded, 1)
}

// wakeBudget is how soon a job queued on an idle dispatcher must finish
// for the wake-up to have done it: the poll is set far beyond it.
const wakeBudget = 2 * time.Second

func TestEnqueueWakesTheDispatcherBeforeThePoll(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	cfg := testConfig()
	cfg.Poll = 10 * time.Second
	service, registry := newTestService(pool, clock, cfg)
	listened := make(chan struct{}, 4)
	service.listening = func() { listened <- struct{}{} }
	Register(registry, "quick", func(context.Context, *Job, NoArgs) error { return nil }, Options{})

	// A job queued before the start is taken by the first pass; waiting for
	// it leaves the dispatcher idle until its ten-second poll.
	first := mustEnqueue(t, service, "quick", nil)
	startDispatcher(t, service)
	waitForState(t, pool, first, StateSucceeded, 1)
	awaitListening(t, listened)
	expectWoken(t, pool, service, wakeBudget)

	// The listener's backend is killed under it; it reconnects after the
	// first backoff and the next enqueue wakes the dispatcher again.
	if _, err := pool.Exec(context.Background(), `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
		WHERE pid <> pg_backend_pid() AND datname = current_database() AND query ILIKE 'LISTEN%'`); err != nil {
		t.Fatal(err)
	}
	awaitListening(t, listened)
	expectWoken(t, pool, service, wakeBudget+restart.BackoffMin)
}

// awaitListening waits for the listener to report a LISTEN in place.
func awaitListening(t *testing.T, listened <-chan struct{}) {
	t.Helper()
	select {
	case <-listened:
	case <-time.After(waitTimeout):
		t.Fatal("the listener did not come up")
	}
}

// expectWoken queues a job and checks it succeeded within the budget.
func expectWoken(t *testing.T, pool *pgxpool.Pool, service *Service, budget time.Duration) {
	t.Helper()
	queued := time.Now()
	id := mustEnqueue(t, service, "quick", nil)
	waitForState(t, pool, id, StateSucceeded, 1)
	if took := time.Since(queued); took > budget {
		t.Errorf("job succeeded %v after enqueue, budget %v", took, budget)
	}
}

// The heartbeat keeps the row fresh between passes, so a long poll does
// not read as a dead runner.
func TestHeartbeatKeepsUpBetweenPolls(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	cfg := testConfig()
	cfg.Poll = 10 * time.Second
	service, _ := newTestService(pool, clock, cfg)
	service.heartbeat = 50 * time.Millisecond
	startDispatcher(t, service)

	// seenAt is the row's heartbeat, or the zero time before it is inserted.
	seenAt := func() time.Time {
		var seen time.Time
		err := pool.QueryRow(context.Background(), `SELECT seen_at FROM job_dispatchers`).Scan(&seen)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("read seen_at: %v", err)
		}
		return seen
	}
	waitFor(t, "the first heartbeat", func() bool { return seenAt().Equal(clock.Now()) })
	clock.Advance(time.Minute)
	waitFor(t, "a heartbeat between polls", func() bool { return seenAt().Equal(clock.Now()) })
}

// The heartbeat is an upsert, so a row that was never written or that
// something removed comes back under the same id.
func TestHeartbeatRestoresADeletedRow(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	cfg := testConfig()
	cfg.Poll = 10 * time.Second
	service, _ := newTestService(pool, clock, cfg)
	service.heartbeat = 50 * time.Millisecond
	startDispatcher(t, service)

	var dispatcherID string
	waitFor(t, "the dispatcher to register", func() bool {
		return pool.QueryRow(context.Background(), `SELECT id FROM job_dispatchers`).Scan(&dispatcherID) == nil
	})
	if _, err := pool.Exec(context.Background(), `DELETE FROM job_dispatchers`); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the row to come back", func() bool {
		return countRows(t, pool, `SELECT count(*) FROM job_dispatchers WHERE id = $1`, dispatcherID) == 1
	})
	if countRows(t, pool, `SELECT count(*) FROM job_dispatchers`) != 1 {
		t.Error("more than one heartbeat row for one dispatcher")
	}
}

// drainBudget is how long ten queued jobs that hold each other back get
// on a ten-second poll: only a finish waking the dispatcher meets it.
const drainBudget = 5 * time.Second

func TestFinishedCappedJobWakesTheDispatcher(t *testing.T) {
	pool := dbtest.New(t)
	cfg := testConfig()
	cfg.Poll = 10 * time.Second
	service, registry := newTestService(pool, newFakeClock(), cfg)
	Register(registry, "capped", func(context.Context, *Job, NoArgs) error { return nil }, Options{MaxInFlight: 1})
	for range 10 {
		mustEnqueue(t, service, "capped", nil)
	}
	expectDrained(t, pool, service, "capped")
}

func TestFinishedLanedJobWakesTheDispatcher(t *testing.T) {
	pool := dbtest.New(t)
	cfg := testConfig()
	cfg.Poll = 10 * time.Second
	service, registry := newTestService(pool, newFakeClock(), cfg)
	Register(registry, "laned", func(context.Context, *Job, laneArgs) error { return nil }, Options{})
	for sequence := range int64(10) {
		mustEnqueueInLane(t, service, "laned", "job", "A", sequence)
	}
	expectDrained(t, pool, service, "laned")
}

// expectDrained starts the dispatcher and checks every row of kind
// succeeded within drainBudget.
func expectDrained(t *testing.T, pool *pgxpool.Pool, service *Service, kind string) {
	t.Helper()
	started := time.Now()
	startDispatcher(t, service)
	waitFor(t, "every "+kind+" job to succeed", func() bool {
		return countRows(t, pool, `SELECT count(*) FROM jobs WHERE kind = $1 AND state <> 'succeeded'`, kind) == 0
	})
	if took := time.Since(started); took > drainBudget {
		t.Errorf("ten %s jobs took %v, budget %v", kind, took, drainBudget)
	}
}
