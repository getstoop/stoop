package main

import (
	"context"

	"github.com/getstoop/stoop/internal/app"
)

// runJobs implements `stoop jobs`: the job dispatcher as its own process,
// for STOOP_JOBS=external or child. It builds no HTTP listener, gateway,
// voice proxy or front door.
func runJobs(ctx context.Context) int {
	proc, err := newProcess(ctx)
	if err != nil {
		return 1
	}
	defer proc.stop()
	runner, err := app.NewRunner(proc.ctx, proc.cfg, proc.log)
	if err != nil {
		proc.log.Error("startup failed", "err", err)
		return 1
	}
	if err := runner.Run(proc.ctx); err != nil {
		proc.log.Error("jobs runner error", "err", err)
		return 1
	}
	return 0
}
