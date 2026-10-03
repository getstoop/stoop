// Package jobs is the background-job queue: a table of jobs, a table of
// schedules that materialise them, and a dispatcher that works them. It
// owns jobs, job_schedules and job_dispatchers and imports no module.
// Callers reach it through their own port; internal/app registers the
// performers and runs the dispatcher. See docs/proposals/jobs.md.
package jobs

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	DefaultWorkers       = 4
	DefaultPoll          = 2 * time.Second
	DefaultShutdownGrace = 10 * time.Second
	DefaultLease         = 10 * time.Minute
	DefaultMaxAttempts   = 4
	// ScheduleLead is how soon after a schedule row is created its first
	// job is due, so a fresh install sweeps soon after boot.
	ScheduleLead = 2 * time.Minute
)

// DefaultBackoff is the wait before attempts 2, 3 and 4; the last wait
// repeats when a kind allows more attempts.
var DefaultBackoff = []time.Duration{5 * time.Second, 30 * time.Second, 2 * time.Minute}

var (
	ErrUnknownKind = errors.New("unknown job kind")
	ErrNotFound    = errors.New("job not found")
)

// Config is the dispatcher's settings; a zero field takes its default.
type Config struct {
	// Workers is how many jobs run at once (STOOP_JOBS_WORKERS).
	Workers int
	// Poll is how often due rows are looked for (STOOP_JOBS_POLL).
	Poll time.Duration
	// Retention is how long finished rows are kept (STOOP_JOBS_RETENTION);
	// 0 keeps them forever and leaves the sweep_jobs schedule disabled.
	Retention time.Duration
	// ShutdownGrace is how long in-flight jobs may finish after the
	// context ends before their leases are cleared.
	ShutdownGrace time.Duration
	// Host names this process in job_dispatchers; "" means os.Hostname().
	Host string
}

// Scheduler is what callers use, through a port of their own. An unknown
// kind is refused with ErrUnknownKind, not stored.
type Scheduler interface {
	// Enqueue queues a job for now and returns its id.
	Enqueue(ctx context.Context, kind string, args any) (string, error)
	// EnqueueAt queues a job for a time and returns its id.
	EnqueueAt(ctx context.Context, kind string, args any, at time.Time) (string, error)
}

// Service is the module: the Scheduler, the schedule loop, the dispatcher
// and the readers the Diagnostics tab uses.
type Service struct{}

// New builds the module over the pool. It registers the sweep_jobs kind
// in registry; the kinds internal/app performs are registered before
// RunDispatcher starts.
func New(pool *pgxpool.Pool, registry *Registry, cfg Config, log *slog.Logger) *Service {
	panic("jobs: not built")
}

// Enqueue queues kind for now; args is marshalled as JSON, nil as {}.
func (s *Service) Enqueue(ctx context.Context, kind string, args any) (string, error) {
	panic("jobs: not built")
}

// EnqueueAt queues kind for at.
func (s *Service) EnqueueAt(ctx context.Context, kind string, args any, at time.Time) (string, error) {
	panic("jobs: not built")
}

// GetRun reads one row; ErrNotFound when there is none.
func (s *Service) GetRun(ctx context.Context, id string) (Run, error) {
	panic("jobs: not built")
}
