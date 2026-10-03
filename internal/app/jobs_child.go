package app

import (
	"context"
	"log/slog"
	"os"
	"os/exec"
	"syscall"
	"time"
)

const (
	childMaxBackoff = 30 * time.Second
	childWaitDelay  = 10 * time.Second
)

// jobsChild supervises one `stoop jobs` process (STOOP_JOBS=child):
// starts it, restarts it with backoff when it exits, and stops it with
// SIGTERM when ctx ends.
type jobsChild struct {
	path string
	args []string
	log  *slog.Logger
}

func newJobsChild(path string, args []string, log *slog.Logger) *jobsChild {
	return &jobsChild{path: path, args: args, log: log}
}

// Run keeps the child running until ctx is done, then waits for it to
// exit, up to childWaitDelay after the SIGTERM.
func (c *jobsChild) Run(ctx context.Context) {
	backoff := time.Second
	lastReason := ""
	for ctx.Err() == nil {
		started := time.Now()
		reason := exitReason(c.runOnce(ctx))
		if ctx.Err() != nil {
			return
		}
		// The same exit every retry is said once.
		level := slog.LevelWarn
		if reason == lastReason {
			level = slog.LevelDebug
		}
		lastReason = reason
		c.log.Log(ctx, level, "jobs: the child runner stopped; restarting", "reason", reason, "in", backoff)
		if time.Since(started) > time.Minute {
			backoff = time.Second
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, childMaxBackoff)
	}
}

// runOnce runs the child to its exit. It inherits the environment,
// stdout and stderr, so its log lines land in the server's stream.
func (c *jobsChild) runOnce(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, c.path, c.args...)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGTERM) }
	cmd.WaitDelay = childWaitDelay
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Wait()
}

func exitReason(err error) string {
	if err == nil {
		return "exit status 0"
	}
	return err.Error()
}
