package jobs

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/dbgen"
)

const waitTimeout = 15 * time.Second

// fakeClock is the module's now; tests advance it by hand so due-ness
// and leases are decided, never raced.
type fakeClock struct {
	mu sync.Mutex
	at time.Time
}

func newFakeClock() *fakeClock {
	return &fakeClock{at: time.Now().Truncate(time.Microsecond)}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.at
}

func (c *fakeClock) Advance(by time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.at = c.at.Add(by)
}

func quietLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func testConfig() Config {
	return Config{Workers: 2, Poll: 20 * time.Millisecond, ShutdownGrace: 2 * time.Second, Host: "test-host"}
}

// newTestService builds a Service with its own registry on the fake clock.
func newTestService(pool *pgxpool.Pool, clock *fakeClock, cfg Config) (*Service, *Registry) {
	registry := NewRegistry()
	service := New(pool, registry, cfg, quietLogger())
	service.now = clock.Now
	return service, registry
}

// startDispatcher runs RunDispatcher until stop is called; stop returns
// how long the dispatcher took to come back after the cancel.
func startDispatcher(t *testing.T, service *Service) (stop func() time.Duration) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	returned := make(chan struct{})
	go func() {
		service.RunDispatcher(ctx)
		close(returned)
	}()
	var once sync.Once
	var took time.Duration
	stop = func() time.Duration {
		once.Do(func() {
			began := time.Now()
			cancel()
			select {
			case <-returned:
			case <-time.After(waitTimeout):
				t.Fatal("RunDispatcher did not return")
			}
			took = time.Since(began)
		})
		return took
	}
	t.Cleanup(func() { stop() })
	return stop
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(waitTimeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func readJob(t *testing.T, pool *pgxpool.Pool, id string) dbgen.Job {
	t.Helper()
	row, err := dbgen.New(pool).GetJob(context.Background(), id)
	if err != nil {
		t.Fatalf("read job %s: %v", id, err)
	}
	return row
}

func waitForState(t *testing.T, pool *pgxpool.Pool, id string, state State, attempt int) dbgen.Job {
	t.Helper()
	var row dbgen.Job
	waitFor(t, "job "+id+" to be "+string(state), func() bool {
		row = readJob(t, pool, id)
		return row.State == string(state) && int(row.Attempt) == attempt
	})
	return row
}

func countRows(t *testing.T, pool *pgxpool.Pool, query string, args ...any) int64 {
	t.Helper()
	var count int64
	if err := pool.QueryRow(context.Background(), query, args...).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	return count
}

func mustEnqueue(t *testing.T, service *Service, kind string, args any) string {
	t.Helper()
	id, err := service.Enqueue(context.Background(), kind, args)
	if err != nil {
		t.Fatalf("enqueue %s: %v", kind, err)
	}
	return id
}

func sameInstant(t *testing.T, what string, got *time.Time, want time.Time) {
	t.Helper()
	if got == nil || !got.Equal(want) {
		t.Errorf("%s = %v, want %v", what, got, want)
	}
}
