// Package jobs is the background-job queue: a table of jobs, a table of
// schedules that materialise them, and a dispatcher that works them. It
// owns jobs, job_schedules and job_dispatchers and imports no module.
// Callers reach it through their own port; internal/app registers the
// performers and runs the dispatcher. See docs/architecture/runtime.md → Background work.
package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/rowid"
)

const (
	DefaultWorkers       = 4
	DefaultPoll          = 2 * time.Second
	DefaultShutdownGrace = 5 * time.Second
	DefaultLease         = 10 * time.Minute
	// DefaultHeartbeat is how often a dispatcher touches its row between
	// passes, so the jobs_runner health row holds whatever the poll is.
	DefaultHeartbeat   = 15 * time.Second
	DefaultMaxAttempts = 4
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
	// 0 keeps them forever.
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
	// EnqueueInLane queues a job for now in a lane, in sequence order.
	EnqueueInLane(ctx context.Context, kind string, args any, lane string, sequence int64) (string, error)
}

// Service is the module: the Scheduler, the schedule loop, the dispatcher
// and the readers the Diagnostics tab uses.
type Service struct {
	pool     *pgxpool.Pool
	queries  *dbgen.Queries
	registry *Registry
	cfg      Config
	log      *slog.Logger
	now      func() time.Time
	// lease is how long one attempt holds its row; the worker renews it
	// every half lease while the performer runs.
	lease time.Duration
	// heartbeat is how often the dispatcher touches job_dispatchers.
	heartbeat time.Duration
	// listening, when set by a test, is called after each LISTEN succeeds.
	listening func()
}

// New builds the module over the pool. It registers the sweep_jobs kind
// in registry; the kinds internal/app performs are registered before
// RunDispatcher starts.
func New(pool *pgxpool.Pool, registry *Registry, cfg Config, log *slog.Logger) *Service {
	if cfg.Workers <= 0 {
		cfg.Workers = DefaultWorkers
	}
	if cfg.Poll <= 0 {
		cfg.Poll = DefaultPoll
	}
	if cfg.ShutdownGrace <= 0 {
		cfg.ShutdownGrace = DefaultShutdownGrace
	}
	if cfg.Host == "" {
		cfg.Host, _ = os.Hostname()
	}
	if log == nil {
		log = slog.Default()
	}
	service := &Service{pool: pool, queries: dbgen.New(pool), registry: registry, cfg: cfg, log: log, now: time.Now, lease: DefaultLease, heartbeat: DefaultHeartbeat}
	Register(registry, SweepJobsKind, service.sweepJobs, Options{})
	return service
}

// Enqueue queues kind for now; args is marshalled as JSON, nil as {}.
func (s *Service) Enqueue(ctx context.Context, kind string, args any) (string, error) {
	return s.EnqueueAt(ctx, kind, args, s.now())
}

// EnqueueAt queues kind for at.
func (s *Service) EnqueueAt(ctx context.Context, kind string, args any, at time.Time) (string, error) {
	return s.insertJob(ctx, kind, args, at, nil, nil)
}

// insertJob is the one insert behind Enqueue, EnqueueAt and EnqueueInLane.
func (s *Service) insertJob(ctx context.Context, kind string, args any, at time.Time, lane *string, sequence *int64) (string, error) {
	entry, ok := s.registry.lookup(kind)
	if !ok {
		return "", fmt.Errorf("enqueue %q: %w", kind, ErrUnknownKind)
	}
	encoded, err := encodeArgs(args)
	if err != nil {
		return "", fmt.Errorf("enqueue %q: %w", kind, err)
	}
	id := rowid.New()
	err = s.queries.InsertJob(ctx, dbgen.InsertJobParams{
		ID: id, Kind: kind, Args: encoded, Lane: lane, Sequence: sequence,
		MaxAttempts: int32(entry.opts.MaxAttempts), NotBefore: at, Now: s.now(),
	})
	if err != nil {
		return "", fmt.Errorf("enqueue %q: %w", kind, err)
	}
	return id, nil
}

// GetRun reads one row; ErrNotFound when there is none.
func (s *Service) GetRun(ctx context.Context, id string) (Run, error) {
	if _, err := uuid.Parse(id); err != nil {
		return Run{}, ErrNotFound
	}
	row, err := s.queries.GetJob(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Run{}, ErrNotFound
	}
	if err != nil {
		return Run{}, fmt.Errorf("get job: %w", err)
	}
	return runFromRow(row), nil
}

// GetRuns reads the rows with these ids; an id with no row, or that is
// not an id, is left out.
func (s *Service) GetRuns(ctx context.Context, ids []string) ([]Run, error) {
	valid := make([]string, 0, len(ids))
	for _, id := range ids {
		if _, err := uuid.Parse(id); err == nil {
			valid = append(valid, id)
		}
	}
	rows, err := s.queries.GetJobs(ctx, valid)
	if err != nil {
		return nil, fmt.Errorf("get jobs: %w", err)
	}
	runs := make([]Run, len(rows))
	for index, row := range rows {
		runs[index] = runFromRow(row)
	}
	return runs, nil
}

// int32Column narrows a count for an int32 column or LIMIT, bounded.
func int32Column(count int) int32 {
	if count > math.MaxInt32 {
		return math.MaxInt32
	}
	return int32(count)
}

func encodeArgs(args any) ([]byte, error) {
	if args == nil {
		return []byte("{}"), nil
	}
	encoded, err := json.Marshal(args)
	if err != nil {
		return nil, fmt.Errorf("encode args: %w", err)
	}
	return encoded, nil
}

func runFromRow(row dbgen.Job) Run {
	run := Run{
		ID: row.ID, Kind: row.Kind, State: State(row.State),
		Attempt: int(row.Attempt), MaxAttempts: int(row.MaxAttempts),
		NotBefore: row.NotBefore, Error: row.Error, CreatedAt: row.CreatedAt,
	}
	if row.StartedAt != nil {
		run.StartedAt = *row.StartedAt
	}
	if row.FinishedAt != nil {
		run.FinishedAt = *row.FinishedAt
	}
	if len(row.Counters) > 0 {
		_ = json.Unmarshal(row.Counters, &run.Counters)
	}
	return run
}
