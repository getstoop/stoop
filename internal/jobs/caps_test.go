package jobs

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

// concurrencyMeter counts the performers of a kind running at once and
// keeps the highest count seen.
type concurrencyMeter struct {
	running atomic.Int32
	highest atomic.Int32
	mu      sync.Mutex
	perJob  map[string]int
}

func newConcurrencyMeter() *concurrencyMeter { return &concurrencyMeter{perJob: map[string]int{}} }

func (m *concurrencyMeter) enter(job *Job) {
	m.mu.Lock()
	m.perJob[job.ID]++
	m.mu.Unlock()
	now := m.running.Add(1)
	for {
		seen := m.highest.Load()
		if now <= seen || m.highest.CompareAndSwap(seen, now) {
			return
		}
	}
}

func (m *concurrencyMeter) leave() { m.running.Add(-1) }

func (m *concurrencyMeter) timesPerformed(id string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.perJob[id]
}

// registerMetered registers kind on registry with the cap; each run is
// counted by meter and takes about 50 ms.
func registerMetered(registry *Registry, kind string, meter *concurrencyMeter, maxInFlight int) {
	Register(registry, kind, func(_ context.Context, job *Job, _ NoArgs) error {
		meter.enter(job)
		defer meter.leave()
		time.Sleep(50 * time.Millisecond)
		return nil
	}, Options{MaxInFlight: maxInFlight})
}

func TestCapOfOneHoldsAcrossTwoDispatchers(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	meter := newConcurrencyMeter()
	first, firstRegistry := newTestService(pool, clock, testConfig())
	registerMetered(firstRegistry, "slow", meter, 1)
	second, secondRegistry := newTestService(pool, clock, testConfig())
	registerMetered(secondRegistry, "slow", meter, 1)

	const total = 10
	ids := make([]string, 0, total)
	for range total {
		ids = append(ids, mustEnqueue(t, first, "slow", nil))
	}
	stopFirst := startDispatcher(t, first)
	stopSecond := startDispatcher(t, second)
	waitFor(t, "every slow job to succeed", func() bool {
		return countRows(t, pool, `SELECT count(*) FROM jobs WHERE kind = 'slow' AND state = 'succeeded'`) == total
	})
	stopFirst()
	stopSecond()

	if highest := meter.highest.Load(); highest != 1 {
		t.Errorf("%d slow jobs ran at once, want exactly 1", highest)
	}
	for _, id := range ids {
		if times := meter.timesPerformed(id); times != 1 {
			t.Errorf("job %s performed %d times", id, times)
		}
	}
}

// registerBlockingUntil registers kind, capped, whose performer counts its
// start and then waits for release to close.
func registerBlockingUntil(registry *Registry, kind string, release <-chan struct{}, maxInFlight int) *atomic.Int32 {
	var started atomic.Int32
	Register(registry, kind, func(context.Context, *Job, NoArgs) error {
		started.Add(1)
		<-release
		return nil
	}, Options{MaxInFlight: maxInFlight})
	return &started
}

// expectStartedCount gives the dispatcher several polls to overshoot.
func expectStartedCount(t *testing.T, kind string, started *atomic.Int32, want int32) {
	t.Helper()
	time.Sleep(5 * testConfig().Poll)
	if got := started.Load(); got != want {
		t.Fatalf("%d %s jobs started, want %d", got, kind, want)
	}
}

func TestCappedKindAtItsCapDoesNotHoldBackUncappedKinds(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	service, registry := newTestService(pool, clock, testConfig())
	release := make(chan struct{})
	started := registerBlockingUntil(registry, "slow", release, 1)
	Register(registry, "quick", func(context.Context, *Job, NoArgs) error { return nil }, Options{})

	slowIDs := []string{mustEnqueue(t, service, "slow", nil), mustEnqueue(t, service, "slow", nil)}
	startDispatcher(t, service)
	waitFor(t, "one slow job to start", func() bool { return started.Load() == 1 })

	quickIDs := []string{mustEnqueue(t, service, "quick", nil), mustEnqueue(t, service, "quick", nil), mustEnqueue(t, service, "quick", nil)}
	for _, id := range quickIDs {
		waitForState(t, pool, id, StateSucceeded, 1)
	}
	expectStartedCount(t, "slow", started, 1)
	if queued := countRows(t, pool, `SELECT count(*) FROM jobs WHERE kind = 'slow' AND state = 'queued'`); queued != 1 {
		t.Fatalf("%d slow jobs queued while one runs, want 1", queued)
	}

	close(release)
	for _, id := range slowIDs {
		waitForState(t, pool, id, StateSucceeded, 1)
	}
	if got := started.Load(); got != 2 {
		t.Errorf("%d slow jobs started in all, want 2", got)
	}
}

func TestCapOfTwoLetsTwoRunAtOnce(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	cfg := testConfig()
	cfg.Workers = 3
	service, registry := newTestService(pool, clock, cfg)
	release := make(chan struct{})
	started := registerBlockingUntil(registry, "pair", release, 2)

	ids := []string{mustEnqueue(t, service, "pair", nil), mustEnqueue(t, service, "pair", nil), mustEnqueue(t, service, "pair", nil)}
	startDispatcher(t, service)
	waitFor(t, "two pair jobs to start", func() bool { return started.Load() == 2 })
	expectStartedCount(t, "pair", started, 2)

	close(release)
	for _, id := range ids {
		waitForState(t, pool, id, StateSucceeded, 1)
	}
}

func TestRegisterRefusesANegativeCap(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("a negative MaxInFlight registered without a panic")
		}
	}()
	Register(NewRegistry(), "negative", func(context.Context, *Job, NoArgs) error { return nil }, Options{MaxInFlight: -1})
}
