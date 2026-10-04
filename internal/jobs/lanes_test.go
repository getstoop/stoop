package jobs

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

type laneArgs struct {
	Name string `json:"name"`
}

// blockingKind is a kind whose performer blocks until the test releases
// the named job, so a test can see what runs together.
type blockingKind struct {
	mu      sync.Mutex
	started map[string]int
	release map[string]chan struct{}
}

func registerBlockingKind(registry *Registry, kind string, names ...string) *blockingKind {
	blocking := &blockingKind{started: map[string]int{}, release: map[string]chan struct{}{}}
	for _, name := range names {
		blocking.release[name] = make(chan struct{})
	}
	Register(registry, kind, func(_ context.Context, _ *Job, args laneArgs) error {
		blocking.mu.Lock()
		blocking.started[args.Name]++
		blocking.mu.Unlock()
		<-blocking.release[args.Name]
		return nil
	}, Options{})
	return blocking
}

func (b *blockingKind) startedCount(name string) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.started[name]
}

func (b *blockingKind) waitStarted(t *testing.T, name string) {
	t.Helper()
	waitFor(t, name+" to start", func() bool { return b.startedCount(name) == 1 })
}

// expectNotStarted gives the dispatcher several polls to make a mistake.
func (b *blockingKind) expectNotStarted(t *testing.T, name string) {
	t.Helper()
	time.Sleep(5 * testConfig().Poll)
	if got := b.startedCount(name); got != 0 {
		t.Fatalf("%s started %d times", name, got)
	}
}

func (b *blockingKind) releaseName(name string) { close(b.release[name]) }

func mustEnqueueInLane(t *testing.T, service *Service, kind, name, lane string, sequence int64) string {
	t.Helper()
	id, err := service.EnqueueInLane(context.Background(), kind, laneArgs{Name: name}, lane, sequence)
	if err != nil {
		t.Fatalf("enqueue %s in lane %s: %v", name, lane, err)
	}
	return id
}

func TestLaneRunsOneAtATimeInSequenceOrder(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	cfg := testConfig()
	cfg.Workers = 3
	service, registry := newTestService(pool, clock, cfg)
	blocking := registerBlockingKind(registry, "laned", "a1", "a2", "b1")

	a2 := mustEnqueueInLane(t, service, "laned", "a2", "A", 2)
	a1 := mustEnqueueInLane(t, service, "laned", "a1", "A", 1)
	b1 := mustEnqueueInLane(t, service, "laned", "b1", "B", 1)
	startDispatcher(t, service)

	blocking.waitStarted(t, "a1")
	blocking.waitStarted(t, "b1")
	blocking.expectNotStarted(t, "a2")
	if row := readJob(t, pool, a2); row.State != string(StateQueued) || row.Attempt != 0 {
		t.Errorf("a2 while a1 runs: state %s attempt %d", row.State, row.Attempt)
	}

	blocking.releaseName("a1")
	blocking.waitStarted(t, "a2")
	blocking.releaseName("a2")
	blocking.releaseName("b1")
	for _, id := range []string{a1, a2, b1} {
		waitForState(t, pool, id, StateSucceeded, 1)
	}
}

func TestLaneHeadWaitingOnBackoffHoldsTheLane(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	service, registry := newTestService(pool, clock, testConfig())
	var mu sync.Mutex
	var order []string
	Register(registry, "laned", func(_ context.Context, job *Job, args laneArgs) error {
		mu.Lock()
		defer mu.Unlock()
		if args.Name == "a1" && job.Attempt == 1 {
			order = append(order, "a1 failed")
			return errors.New("first try")
		}
		order = append(order, args.Name)
		return nil
	}, Options{})

	a1 := mustEnqueueInLane(t, service, "laned", "a1", "A", 1)
	a2 := mustEnqueueInLane(t, service, "laned", "a2", "A", 2)
	startDispatcher(t, service)

	row := waitForState(t, pool, a1, StateQueued, 1)
	if !row.NotBefore.Equal(clock.Now().Add(DefaultBackoff[0])) {
		t.Fatalf("a1 not_before = %v, want now + %v", row.NotBefore, DefaultBackoff[0])
	}
	time.Sleep(5 * testConfig().Poll)
	if row := readJob(t, pool, a2); row.State != string(StateQueued) || row.Attempt != 0 {
		t.Fatalf("a2 ran while a1 waited on its backoff: state %s attempt %d", row.State, row.Attempt)
	}

	clock.Advance(DefaultBackoff[0] + time.Second)
	waitForState(t, pool, a1, StateSucceeded, 2)
	waitForState(t, pool, a2, StateSucceeded, 1)
	mu.Lock()
	defer mu.Unlock()
	if got := strings.Join(order, ", "); got != "a1 failed, a1, a2" {
		t.Errorf("ran in order %q", got)
	}
}

func TestDiscardLaneReleasesTheLane(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	ctx := context.Background()
	service, registry := newTestService(pool, clock, testConfig())
	blocking := registerBlockingKind(registry, "laned", "a1", "a2", "a3", "a4")

	a1 := mustEnqueueInLane(t, service, "laned", "a1", "A", 1)
	a2 := mustEnqueueInLane(t, service, "laned", "a2", "A", 2)
	a3 := mustEnqueueInLane(t, service, "laned", "a3", "A", 3)
	startDispatcher(t, service)
	blocking.waitStarted(t, "a1")

	discarded, err := service.DiscardLane(ctx, "A", "hook deleted")
	if err != nil || discarded != 2 {
		t.Fatalf("DiscardLane = %d, %v", discarded, err)
	}
	for _, id := range []string{a2, a3} {
		row := readJob(t, pool, id)
		if row.State != string(StateDiscarded) || row.Error != "hook deleted" || row.FinishedAt == nil || row.Attempt != 0 || string(row.Args) != "{}" {
			t.Errorf("discarded row: state %s error %q finished_at %v attempt %d args %s", row.State, row.Error, row.FinishedAt, row.Attempt, row.Args)
		}
	}
	if row := readJob(t, pool, a1); row.State != string(StateRunning) || string(row.Args) != `{"name": "a1"}` {
		t.Errorf("a1 after DiscardLane: state %s args %s", row.State, row.Args)
	}

	// The lane is free for what comes after.
	a4 := mustEnqueueInLane(t, service, "laned", "a4", "A", 4)
	blocking.expectNotStarted(t, "a4")
	blocking.releaseName("a1")
	waitForState(t, pool, a1, StateSucceeded, 1)
	blocking.waitStarted(t, "a4")
	blocking.releaseName("a4")
	waitForState(t, pool, a4, StateSucceeded, 1)
	for _, name := range []string{"a2", "a3"} {
		if blocking.startedCount(name) != 0 {
			t.Errorf("%s ran after being discarded", name)
		}
	}
}

func TestEnqueueInLaneNeedsALane(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	ctx := context.Background()
	service, registry := newTestService(pool, clock, testConfig())
	Register(registry, "laned", func(context.Context, *Job, laneArgs) error { return nil }, Options{})

	if _, err := service.EnqueueInLane(ctx, "laned", nil, "", 1); !errors.Is(err, errEmptyLane) {
		t.Errorf("empty lane: %v", err)
	}
	if _, err := service.EnqueueInLane(ctx, "nope", nil, "A", 1); !errors.Is(err, ErrUnknownKind) {
		t.Errorf("unknown kind: %v", err)
	}
	if countRows(t, pool, `SELECT count(*) FROM jobs`) != 0 {
		t.Error("a refused enqueue left a row")
	}

	_, err := pool.Exec(ctx, `INSERT INTO jobs (id, kind, lane, state, max_attempts, not_before, created_at)
		VALUES ('00000000-0000-7000-8000-000000000001', 'laned', 'A', 'queued', 4, $1, $1)`, clock.Now())
	if err == nil || !strings.Contains(err.Error(), "jobs_lane_sequence_check") {
		t.Errorf("a lane without a sequence was stored: %v", err)
	}
}

func TestEnqueueInLaneTxFollowsTheTransaction(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	service, registry := newTestService(pool, newFakeClock(), testConfig())
	Register(registry, "laned", func(context.Context, *Job, laneArgs) error { return nil }, Options{})

	rolledBack := errors.New("roll back")
	err := db.InTx(ctx, pool, func(tx pgx.Tx) error {
		if _, err := service.EnqueueInLaneTx(ctx, tx, "laned", laneArgs{Name: "dropped"}, "A", 1); err != nil {
			return err
		}
		return rolledBack
	})
	if !errors.Is(err, rolledBack) {
		t.Fatalf("rolled-back transaction: %v", err)
	}
	if countRows(t, pool, `SELECT count(*) FROM jobs`) != 0 {
		t.Error("a rolled-back enqueue left a row")
	}

	var id string
	if err := db.InTx(ctx, pool, func(tx pgx.Tx) error {
		var err error
		id, err = service.EnqueueInLaneTx(ctx, tx, "laned", laneArgs{Name: "kept"}, "A", 2)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if row := readJob(t, pool, id); row.Lane == nil || *row.Lane != "A" || row.Sequence == nil || *row.Sequence != 2 {
		t.Errorf("committed enqueue: %+v", row)
	}
	if _, err := service.EnqueueInLaneTx(ctx, nil, "laned", nil, "", 1); !errors.Is(err, errEmptyLane) {
		t.Errorf("empty lane: %v", err)
	}
}
