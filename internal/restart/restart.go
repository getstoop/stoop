// Package restart keeps a piece of work running: a connection that must
// stay open, a child process that must stay up. Loop runs the body again
// after each return, with a backoff that doubles while it keeps failing
// and resets once a run has held for a while.
package restart

import (
	"context"
	"log/slog"
	"time"
)

const (
	// BackoffMin is the first wait, exported so a test can budget for it.
	BackoffMin = time.Second
	backoffMax = 30 * time.Second
	// steady is how long a run must have held for the next failure to
	// start the backoff over.
	steady = time.Minute
)

// Loop runs body until ctx ends, starting it again after each return.
// The wait before a restart doubles from one second to thirty while runs
// keep failing and goes back to one second once a run has lasted a
// minute. Each stop is logged with message at warn, or at debug when it
// is the same error as the last time, so a failure that repeats every
// retry is said once.
func Loop(ctx context.Context, log *slog.Logger, message string, body func(context.Context) error) {
	backoff := BackoffMin
	lastErr := ""
	for ctx.Err() == nil {
		started := time.Now()
		err := body(ctx)
		if ctx.Err() != nil {
			return
		}
		if time.Since(started) > steady {
			backoff = BackoffMin
		}
		level := slog.LevelWarn
		if reason(err) == lastErr {
			level = slog.LevelDebug
		} else {
			lastErr = reason(err)
		}
		log.Log(ctx, level, message, "err", err, "in", backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, backoffMax)
	}
}

func reason(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
