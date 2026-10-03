package jobs

import (
	"context"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

func TestBacklogCounts(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	ctx := context.Background()
	service, _ := newTestService(pool, clock, testConfig())
	now := clock.Now()
	insert := func(id, kind, state string, notBefore time.Time, leasedUntil *time.Time, lane *string, sequence *int64) {
		_, err := pool.Exec(ctx, `INSERT INTO jobs (id, kind, state, max_attempts, not_before, leased_until, lane, sequence, created_at)
			VALUES ($1, $2, $3, 4, $4, $5, $6, $7, $4)`, id, kind, state, notBefore, leasedUntil, lane, sequence)
		if err != nil {
			t.Fatal(err)
		}
	}
	liveLease, lapsedLease := now.Add(5*time.Minute), now.Add(-time.Minute)
	laneBusy, laneFree := "busy", "free"
	first, second := int64(1), int64(2)
	insert("00000000-0000-7000-8000-000000000001", "counted", "queued", now.Add(-time.Minute), nil, nil, nil)
	insert("00000000-0000-7000-8000-000000000002", "counted", "queued", now.Add(time.Hour), nil, nil, nil)
	insert("00000000-0000-7000-8000-000000000003", "counted", "running", now.Add(-time.Hour), &liveLease, nil, nil)
	insert("00000000-0000-7000-8000-000000000004", "counted", "running", now.Add(-2*time.Minute), &lapsedLease, nil, nil)
	insert("00000000-0000-7000-8000-000000000005", "counted", "succeeded", now.Add(-time.Hour), nil, nil, nil)
	insert("00000000-0000-7000-8000-000000000006", "other", "queued", now.Add(-time.Hour), nil, nil, nil)
	// A row held behind its lane's running head has waited an hour on
	// paper and is not due; a lane's queued head is.
	insert("00000000-0000-7000-8000-000000000007", "counted", "running", now.Add(-time.Hour), &liveLease, &laneBusy, &first)
	insert("00000000-0000-7000-8000-000000000008", "counted", "queued", now.Add(-time.Hour), nil, &laneBusy, &second)
	insert("00000000-0000-7000-8000-000000000009", "counted", "queued", now.Add(-3*time.Minute), nil, &laneFree, &first)
	insert("00000000-0000-7000-8000-000000000010", "counted", "queued", now.Add(-4*time.Minute), nil, &laneFree, &second)

	backlog, err := service.Backlog(ctx, "counted")
	if err != nil {
		t.Fatal(err)
	}
	if backlog.Queued != 6 || backlog.Running != 2 || !backlog.OldestDue.Equal(now.Add(-3*time.Minute)) {
		t.Errorf("backlog = %+v", backlog)
	}

	clock.Advance(-time.Hour)
	backlog, err = service.Backlog(ctx, "counted")
	if err != nil {
		t.Fatal(err)
	}
	if backlog.Queued != 2 || backlog.Running != 3 || !backlog.OldestDue.IsZero() {
		t.Errorf("backlog an hour earlier = %+v", backlog)
	}
}
