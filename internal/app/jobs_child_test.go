package app_test

import (
	"context"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/app"
)

const (
	// fakeJobsEnv selects the fake `stoop jobs`: "ok" waits for SIGTERM
	// and exits 0, "crash" exits 1 at once.
	fakeJobsEnv = "STOOP_FAKE_JOBS"
	// fakeJobsLogEnv names a file each start appends a line to.
	fakeJobsLogEnv = "STOOP_FAKE_JOBS_LOG"
)

// fakeJobsMain runs the fake and never returns.
func fakeJobsMain() {
	if path := os.Getenv(fakeJobsLogEnv); path != "" {
		file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
		if err != nil {
			os.Exit(2)
		}
		_, _ = file.WriteString("started\n")
		_ = file.Close()
	}
	if os.Getenv(fakeJobsEnv) == "crash" {
		os.Exit(1)
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, os.Interrupt)
	<-stop
	os.Exit(0)
}

// startFakeChild runs the supervisor over this binary as the fake in
// mode. starts counts the child's starts so far; wait fails the test
// unless the supervisor returns within the time given.
func startFakeChild(t *testing.T, ctx context.Context, mode string) (starts func() int, wait func(within time.Duration)) {
	t.Helper()
	logPath := filepath.Join(t.TempDir(), "starts")
	t.Setenv(fakeJobsEnv, mode)
	t.Setenv(fakeJobsLogEnv, logPath)
	supervisor := app.NewJobsChild(os.Args[0], []string{"jobs"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	done := make(chan struct{})
	go func() {
		supervisor.Run(ctx)
		close(done)
	}()
	starts = func() int {
		data, _ := os.ReadFile(logPath)
		return strings.Count(string(data), "started\n")
	}
	wait = func(within time.Duration) {
		t.Helper()
		select {
		case <-done:
		case <-time.After(within):
			t.Fatalf("the supervisor did not return within %v", within)
		}
	}
	return starts, wait
}

// awaitStarts polls until the child has started want times.
func awaitStarts(t *testing.T, starts func() int, want int, within time.Duration) {
	t.Helper()
	deadline := time.Now().Add(within)
	for starts() < want {
		if time.Now().After(deadline) {
			t.Fatalf("the child started %d times in %v, want %d", starts(), within, want)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestJobsChildStartsAndStopsOnCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	starts, wait := startFakeChild(t, ctx, "ok")
	awaitStarts(t, starts, 1, 5*time.Second)

	cancel()
	wait(3 * time.Second)
	if starts() != 1 {
		t.Errorf("the child started %d times, want once", starts())
	}
}

func TestJobsChildRestartsAfterACrash(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	starts, wait := startFakeChild(t, ctx, "crash")
	awaitStarts(t, starts, 2, 5*time.Second)

	cancel()
	wait(3 * time.Second)
}
