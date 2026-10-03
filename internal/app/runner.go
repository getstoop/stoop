package app

import (
	"context"
	"errors"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/jobs"
)

// Runner is the composition root for `stoop jobs`: the modules and the
// performers, with no listener, gateway, voice proxy or front door.
type Runner struct {
	jobs *jobs.Service
	pool *pgxpool.Pool
	log  *slog.Logger
}

// NewRunner builds the modules the way New does, less what only the
// server runs.
func NewRunner(ctx context.Context, cfg config.Config, log *slog.Logger) (*Runner, error) {
	return nil, errors.New("stoop jobs: not built yet")
}

// Run works the queue until ctx ends, then releases what it holds and
// closes the pool.
func (r *Runner) Run(ctx context.Context) error {
	return errors.New("stoop jobs: not built yet")
}
