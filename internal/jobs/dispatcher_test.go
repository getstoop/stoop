package jobs

import (
	"context"
	"strings"
	"sync"
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

	took := stop()
	if took > cfg.ShutdownGrace+3*time.Second {
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
