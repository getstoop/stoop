package jobs

import (
	"context"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

func TestSweepJobsRemovesOldFinishedRows(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	ctx := context.Background()
	cfg := testConfig()
	cfg.Retention = time.Hour
	service, _ := newTestService(pool, clock, cfg)

	now := clock.Now()
	insertJob := func(id, state string, finishedAt *time.Time) {
		_, err := pool.Exec(ctx, `INSERT INTO jobs (id, kind, state, max_attempts, not_before, finished_at, created_at)
			VALUES ($1, 'sweep_jobs', $2, 4, $3, $4, $3)`, id, state, now.Add(-3*time.Hour), finishedAt)
		if err != nil {
			t.Fatal(err)
		}
	}
	old, young := now.Add(-2*time.Hour), now.Add(-30*time.Minute)
	insertJob("00000000-0000-7000-8000-000000000001", "succeeded", &old)
	insertJob("00000000-0000-7000-8000-000000000002", "discarded", &old)
	insertJob("00000000-0000-7000-8000-000000000003", "succeeded", &young)
	insertJob("00000000-0000-7000-8000-000000000004", "queued", nil)
	insertJob("00000000-0000-7000-8000-000000000005", "running", &old)
	insertDispatcher := func(id string, seenAt time.Time) {
		_, err := pool.Exec(ctx, `INSERT INTO job_dispatchers (id, host, workers, started_at, seen_at) VALUES ($1, 'h', 1, $2, $2)`, id, seenAt)
		if err != nil {
			t.Fatal(err)
		}
	}
	insertDispatcher("00000000-0000-7000-8000-000000000011", now.Add(-2*time.Hour))
	insertDispatcher("00000000-0000-7000-8000-000000000012", now)

	job := &Job{ID: "sweep", Kind: SweepJobsKind, Attempt: 1}
	if err := service.sweepJobs(ctx, job, NoArgs{}); err != nil {
		t.Fatal(err)
	}
	if counters := job.recorded(); counters["jobs_removed"] != 2 || counters["dispatchers_removed"] != 1 {
		t.Errorf("counters = %v", counters)
	}
	if got := countRows(t, pool, `SELECT count(*) FROM jobs`); got != 3 {
		t.Errorf("%d jobs left, want 3", got)
	}
	if got := countRows(t, pool, `SELECT count(*) FROM job_dispatchers`); got != 1 {
		t.Errorf("%d dispatchers left, want 1", got)
	}

	service.cfg.Retention = 0
	job = &Job{ID: "sweep", Kind: SweepJobsKind, Attempt: 1}
	if err := service.sweepJobs(ctx, job, NoArgs{}); err != nil {
		t.Fatal(err)
	}
	if got := countRows(t, pool, `SELECT count(*) FROM jobs`); got != 3 || job.recorded()["jobs_removed"] != 0 {
		t.Errorf("retention 0 removed rows: %d left, counters %v", got, job.recorded())
	}
}
