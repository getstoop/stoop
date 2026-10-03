package app

import (
	"context"
	"io"
	"log/slog"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/jobs"
)

// schedulingAllowance is what a loaded machine may add to the budget.
const schedulingAllowance = 2 * time.Second

// newShutdownApp builds the whole binary on a throwaway database, bound
// to listenAddr, and returns it with a pool of the test's own on that
// database, for reading rows after Run has closed the app's.
func newShutdownApp(t *testing.T, listenAddr string) (*App, *pgxpool.Pool) {
	t.Helper()
	databaseURL := dbtest.NewURL(t)
	t.Setenv("STOOP_DATABASE_URL", databaseURL)
	t.Setenv("STOOP_STORAGE_DIR", t.TempDir())
	t.Setenv("STOOP_LISTEN_ADDR", listenAddr)
	t.Setenv("STOOP_JOBS_POLL", "100ms")
	t.Setenv("STOOP_AUTH_RATE_LIMIT", "0")
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	application, err := New(context.Background(), cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return application, pool
}

// runInBackground starts Run on a goroutine and returns what it comes back
// with, failing the test when that takes longer than within.
func runInBackground(t *testing.T, ctx context.Context, application *App) (wait func(within time.Duration) error) {
	t.Helper()
	returned := make(chan error, 1)
	go func() { returned <- application.Run(ctx) }()
	return func(within time.Duration) error {
		t.Helper()
		select {
		case err := <-returned:
			return err
		case <-time.After(within):
			t.Fatalf("Run did not return within %v", within)
			return nil
		}
	}
}

func TestRunShutdownStaysInsideTheBudget(t *testing.T) {
	application, pool := newShutdownApp(t, "127.0.0.1:0")
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	jobs.Register(application.registry, "blocks", func(context.Context, *jobs.Job, jobs.NoArgs) error {
		<-release
		return nil
	}, jobs.Options{})
	id, err := application.jobs.Enqueue(context.Background(), "blocks", nil)
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	wait := runInBackground(t, ctx, application)
	deadline := time.Now().Add(15 * time.Second)
	for {
		run, err := application.jobs.GetRun(context.Background(), id)
		if err == nil && run.State == jobs.StateRunning {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("job never ran: state %q, err %v", run.State, err)
		}
		time.Sleep(10 * time.Millisecond)
	}

	// The performer ignores its context, so the dispatcher gives the row
	// back after its grace, and Run comes back inside the ten seconds.
	began := time.Now()
	cancel()
	err = wait(shutdownTimeout + schedulingAllowance)
	took := time.Since(began)
	if err != nil {
		t.Fatalf("Run returned %v after %v", err, took)
	}
	var state, errText string
	var attempt int
	if err := pool.QueryRow(context.Background(), `SELECT state, attempt, error FROM jobs WHERE id = $1`, id).Scan(&state, &attempt, &errText); err != nil {
		t.Fatal(err)
	}
	if state != string(jobs.StateQueued) || attempt != 0 || errText != "" {
		t.Errorf("after shutdown: state %s attempt %d error %q", state, attempt, errText)
	}
}

func TestRunListenerFailureStopsTheBackgroundWork(t *testing.T) {
	taken, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = taken.Close() })
	application, pool := newShutdownApp(t, taken.Addr().String())

	wait := runInBackground(t, context.Background(), application)
	err = wait(5 * time.Second)
	if err == nil || !strings.Contains(err.Error(), "serve:") {
		t.Fatalf("Run returned %v, want a serve error", err)
	}
	var dispatchers int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM job_dispatchers`).Scan(&dispatchers); err != nil {
		t.Fatal(err)
	}
	if dispatchers != 0 {
		t.Errorf("%d dispatcher rows left after Run returned", dispatchers)
	}
}
