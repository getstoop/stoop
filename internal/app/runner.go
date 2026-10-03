package app

import (
	"context"
	"log/slog"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/jobs"
)

// Runner is the composition root for `stoop jobs`: the modules and the
// performers, with no listener, gateway, voice proxy or front door.
type Runner struct {
	jobs    *jobs.Service
	pool    *pgxpool.Pool
	log     *slog.Logger
	workers int
}

// NewRunner builds the modules the way New does, less what only the
// server runs.
func NewRunner(ctx context.Context, cfg config.Config, log *slog.Logger) (*Runner, error) {
	shared, err := newModules(ctx, cfg, log)
	if err != nil {
		return nil, err
	}
	return &Runner{jobs: shared.jobs, pool: shared.pool, log: log, workers: cfg.JobsWorkers}, nil
}

// Run works the queue until ctx ends, then releases what it holds and
// closes the pool. Only the dispatcher runs here: the webhook subscriber
// reads the in-process bus, which only the server publishes to, so it
// stays in the server in every mode.
func (r *Runner) Run(ctx context.Context) error {
	host, _ := os.Hostname()
	r.log.Info("jobs runner started", "host", host, "workers", r.workers)
	r.jobs.RunDispatcher(ctx)
	r.pool.Close()
	return nil
}
