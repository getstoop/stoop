package jobs

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/dbgen"
)

func readSchedule(t *testing.T, pool *pgxpool.Pool, kind string) dbgen.JobSchedule {
	t.Helper()
	rows, err := dbgen.New(pool).ListSchedules(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if row.Kind == kind {
			return row
		}
	}
	t.Fatalf("no schedule row for %s", kind)
	return dbgen.JobSchedule{}
}

func TestScheduleInsertsOncePerIntervalAndKeepsNextDue(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	ctx := context.Background()
	service, registry := newTestService(pool, clock, testConfig())
	Register(registry, "tick", func(context.Context, *Job, NoArgs) error { return nil }, Options{})

	for range 2 {
		if err := service.Schedule(ctx, "tick", 10*time.Minute); err != nil {
			t.Fatal(err)
		}
	}
	if countRows(t, pool, `SELECT count(*) FROM job_schedules`) != 1 {
		t.Fatal("Schedule twice made two rows")
	}
	row := readSchedule(t, pool, "tick")
	if !row.Enabled || row.IntervalMs != (10*time.Minute).Milliseconds() || !row.NextDue.Equal(clock.Now().Add(ScheduleLead)) {
		t.Errorf("new row = %+v, want enabled, 10 min, due at now + lead", row)
	}

	if err := service.Schedule(ctx, "tick", 0); err != nil {
		t.Fatal(err)
	}
	row = readSchedule(t, pool, "tick")
	if row.Enabled || row.IntervalMs != 0 || !row.NextDue.Equal(clock.Now().Add(ScheduleLead)) {
		t.Errorf("disabled row = %+v", row)
	}

	if err := service.Schedule(ctx, "tick", time.Minute); err != nil {
		t.Fatal(err)
	}
	row = readSchedule(t, pool, "tick")
	if !row.Enabled || !row.NextDue.Equal(clock.Now().Add(time.Minute)) {
		t.Errorf("shortened row = %+v, want due at now + 1m", row)
	}
	if err := service.Schedule(ctx, "tick", 10*time.Minute); err != nil {
		t.Fatal(err)
	}
	if row = readSchedule(t, pool, "tick"); !row.NextDue.Equal(clock.Now().Add(time.Minute)) {
		t.Errorf("lengthened row moved next_due to %v", row.NextDue)
	}

	stop := startDispatcher(t, service)
	time.Sleep(5 * testConfig().Poll)
	if got := countRows(t, pool, `SELECT count(*) FROM jobs WHERE kind = 'tick'`); got != 0 {
		t.Fatalf("%d tick jobs before next_due", got)
	}
	clock.Advance(time.Minute + time.Second)
	waitFor(t, "the schedule to insert a job", func() bool {
		return countRows(t, pool, `SELECT count(*) FROM jobs WHERE kind = 'tick'`) == 1
	})
	time.Sleep(5 * testConfig().Poll)
	if got := countRows(t, pool, `SELECT count(*) FROM jobs WHERE kind = 'tick'`); got != 1 {
		t.Errorf("%d tick jobs after one interval, want 1", got)
	}
	row = readSchedule(t, pool, "tick")
	if !row.NextDue.Equal(clock.Now().Add(10 * time.Minute)) {
		t.Errorf("next_due = %v, want now + 10m", row.NextDue)
	}
	if row.LastJobID == nil {
		t.Error("last_job_id not set")
	}
	stop()

	// A restart schedules again and keeps next_due.
	restarted, restartedRegistry := newTestService(pool, clock, testConfig())
	Register(restartedRegistry, "tick", func(context.Context, *Job, NoArgs) error { return nil }, Options{})
	if err := restarted.Schedule(ctx, "tick", 10*time.Minute); err != nil {
		t.Fatal(err)
	}
	if again := readSchedule(t, pool, "tick"); !again.NextDue.Equal(row.NextDue) {
		t.Errorf("restart moved next_due from %v to %v", row.NextDue, again.NextDue)
	}
}

func TestSchedulesReportsLastRuns(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	ctx := context.Background()
	service, registry := newTestService(pool, clock, testConfig())
	noop := func(context.Context, *Job, NoArgs) error { return nil }
	Register(registry, "alpha", noop, Options{})
	Register(registry, "beta", noop, Options{})
	for _, kind := range []string{"beta", "alpha"} {
		if err := service.Schedule(ctx, kind, time.Hour); err != nil {
			t.Fatal(err)
		}
	}

	now := clock.Now()
	succeededAt := now.Add(-10 * time.Minute)
	discardedAt := now.Add(-5 * time.Minute)
	insert := func(id, state string, startedAt *time.Time, errText string) {
		_, err := pool.Exec(ctx, `INSERT INTO jobs (id, kind, state, attempt, max_attempts, not_before, started_at, finished_at, error, created_at)
			VALUES ($1, 'alpha', $2, 1, 4, $3, $4, $4, $5, $3)`, id, state, now.Add(-time.Hour), startedAt, errText)
		if err != nil {
			t.Fatal(err)
		}
	}
	insert("00000000-0000-7000-8000-000000000001", "succeeded", &succeededAt, "")
	insert("00000000-0000-7000-8000-000000000002", "discarded", &discardedAt, "gave up")
	insert("00000000-0000-7000-8000-000000000003", "queued", nil, "")
	insert("00000000-0000-7000-8000-000000000004", "queued", nil, "")

	schedules, err := service.Schedules(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(schedules) != 2 || schedules[0].Kind != "alpha" || schedules[1].Kind != "beta" {
		t.Fatalf("schedules = %+v", schedules)
	}
	alpha, beta := schedules[0], schedules[1]
	if alpha.Interval != time.Hour || !alpha.Enabled || alpha.Queued != 2 || !alpha.LastSuccess.Equal(succeededAt) {
		t.Errorf("alpha = %+v", alpha)
	}
	if alpha.Last == nil || alpha.Last.State != StateDiscarded || alpha.Last.Error != "gave up" || !alpha.Last.StartedAt.Equal(discardedAt) {
		t.Errorf("alpha.Last = %+v", alpha.Last)
	}
	if beta.Last != nil || !beta.LastSuccess.IsZero() || beta.Queued != 0 {
		t.Errorf("beta = %+v", beta)
	}
}

func TestUnknownKindIsRefused(t *testing.T) {
	pool := dbtest.New(t)
	service, _ := newTestService(pool, newFakeClock(), testConfig())
	ctx := context.Background()
	if _, err := service.Enqueue(ctx, "nope", nil); !errors.Is(err, ErrUnknownKind) {
		t.Errorf("Enqueue = %v", err)
	}
	if _, err := service.EnqueueAt(ctx, "nope", nil, time.Now()); !errors.Is(err, ErrUnknownKind) {
		t.Errorf("EnqueueAt = %v", err)
	}
	if err := service.Schedule(ctx, "nope", time.Minute); !errors.Is(err, ErrUnknownKind) {
		t.Errorf("Schedule = %v", err)
	}
	if countRows(t, pool, `SELECT count(*) FROM jobs`)+countRows(t, pool, `SELECT count(*) FROM job_schedules`) != 0 {
		t.Error("a refused kind left a row")
	}
}

func TestScheduleWaitsForTheRunningRun(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	ctx := context.Background()
	service, registry := newTestService(pool, clock, testConfig())
	release := make(chan struct{})
	Register(registry, "tick", func(context.Context, *Job, NoArgs) error {
		<-release
		return nil
	}, Options{})
	if err := service.Schedule(ctx, "tick", time.Minute); err != nil {
		t.Fatal(err)
	}
	firstDue := clock.Now().Add(ScheduleLead)
	countTicks := func() int64 { return countRows(t, pool, `SELECT count(*) FROM jobs WHERE kind = 'tick'`) }
	expectHeld := func(what string, ticks int64, nextDue time.Time) {
		t.Helper()
		time.Sleep(5 * testConfig().Poll)
		if got := countTicks(); got != ticks {
			t.Fatalf("%s: %d tick rows, want %d", what, got, ticks)
		}
		if row := readSchedule(t, pool, "tick"); !row.NextDue.Equal(nextDue) {
			t.Fatalf("%s: next_due moved to %v", what, row.NextDue)
		}
	}

	// A queued run of the kind holds the schedule.
	queued, err := service.EnqueueAt(ctx, "tick", nil, clock.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	startDispatcher(t, service)
	clock.Advance(ScheduleLead + time.Second)
	expectHeld("while a run is queued", 1, firstDue)

	if _, err := pool.Exec(ctx, `DELETE FROM jobs WHERE id = $1`, queued); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the schedule to insert a run", func() bool { return countTicks() == 1 && readSchedule(t, pool, "tick").LastJobID != nil })
	secondDue := clock.Now().Add(time.Minute)
	if row := readSchedule(t, pool, "tick"); !row.NextDue.Equal(secondDue) {
		t.Fatalf("next_due = %v, want now + 1m", row.NextDue)
	}
	running := *readSchedule(t, pool, "tick").LastJobID
	waitForState(t, pool, running, StateRunning, 1)

	// A running one holds it too.
	clock.Advance(time.Minute + time.Second)
	expectHeld("while a run is running", 1, secondDue)

	close(release)
	waitForState(t, pool, running, StateSucceeded, 1)
	waitFor(t, "the schedule to insert the next run", func() bool { return countTicks() == 2 })
	if row := readSchedule(t, pool, "tick"); !row.NextDue.Equal(clock.Now().Add(time.Minute)) {
		t.Errorf("next_due after the run = %v, want now + 1m", row.NextDue)
	}
}
