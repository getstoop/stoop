package jobs

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/rowid"
)

// State is a jobs row's state. Running means the lease is in the future;
// a running row whose lease has passed is claimed again.
type State string

const (
	StateQueued    State = "queued"
	StateRunning   State = "running"
	StateSucceeded State = "succeeded"
	StateDiscarded State = "discarded"
)

// Run is one jobs row: one job, however many attempts it took. Only the
// latest attempt's timing and error are kept. A zero time means not yet.
type Run struct {
	ID          string
	Kind        string
	State       State
	Attempt     int
	MaxAttempts int
	NotBefore   time.Time
	StartedAt   time.Time
	FinishedAt  time.Time
	Error       string
	Counters    Counters
	CreatedAt   time.Time
}

// Schedule is one periodic kind as the Diagnostics tab shows it.
type Schedule struct {
	Kind     string
	Interval time.Duration
	Enabled  bool
	NextDue  time.Time
	// Last is the most recent run of the kind that started; nil if none.
	Last *Run
	// LastSuccess is when the kind last succeeded; zero if never.
	LastSuccess time.Time
	// Queued is how many runs of the kind are waiting to start.
	Queued int64
}

// Schedule makes kind periodic. A new row is due at now + ScheduleLead; an
// existing row keeps its next_due, moved earlier only if the new interval
// would pass first. every <= 0 keeps the row and sets enabled = false. An
// unregistered kind is ErrUnknownKind.
func (s *Service) Schedule(ctx context.Context, kind string, every time.Duration) error {
	if _, ok := s.registry.lookup(kind); !ok {
		return fmt.Errorf("schedule %q: %w", kind, ErrUnknownKind)
	}
	now := s.now()
	params := dbgen.UpsertScheduleParams{Kind: kind, FirstDue: now.Add(ScheduleLead), MovedDue: now}
	if every > 0 {
		params.IntervalMs = every.Milliseconds()
		params.Enabled = true
		params.MovedDue = now.Add(every)
	}
	if err := s.queries.UpsertSchedule(ctx, params); err != nil {
		return fmt.Errorf("schedule %q: %w", kind, err)
	}
	return nil
}

// Schedules lists every schedule row with its latest run, sorted by kind.
func (s *Service) Schedules(ctx context.Context) ([]Schedule, error) {
	rows, err := s.queries.ListSchedules(ctx)
	if err != nil {
		return nil, fmt.Errorf("list schedules: %w", err)
	}
	schedules := make([]Schedule, 0, len(rows))
	for _, row := range rows {
		schedule := Schedule{
			Kind: row.Kind, Interval: time.Duration(row.IntervalMs) * time.Millisecond,
			Enabled: row.Enabled, NextDue: row.NextDue,
		}
		last, found, err := optionalRow(s.queries.LastStartedJob(ctx, row.Kind))
		if err != nil {
			return nil, fmt.Errorf("last run of %q: %w", row.Kind, err)
		}
		if found {
			run := runFromRow(last)
			schedule.Last = &run
		}
		succeeded, found, err := optionalRow(s.queries.LastSucceededJob(ctx, row.Kind))
		if err != nil {
			return nil, fmt.Errorf("last success of %q: %w", row.Kind, err)
		}
		if found && succeeded.StartedAt != nil {
			schedule.LastSuccess = *succeeded.StartedAt
		}
		if schedule.Queued, err = s.queries.CountQueuedJobs(ctx, row.Kind); err != nil {
			return nil, fmt.Errorf("queued runs of %q: %w", row.Kind, err)
		}
		schedules = append(schedules, schedule)
	}
	return schedules, nil
}

func optionalRow(row dbgen.Job, err error) (dbgen.Job, bool, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return dbgen.Job{}, false, nil
	}
	return row, err == nil, err
}

// materialiseDue inserts one queued run for each due schedule and
// advances it, in one transaction so a second dispatcher skips the locked
// rows.
func (s *Service) materialiseDue(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	queries := s.queries.WithTx(tx)
	now := s.now()
	due, err := queries.DueSchedules(ctx, now)
	if err != nil {
		return err
	}
	for _, schedule := range due {
		entry, ok := s.registry.lookup(schedule.Kind)
		if !ok || schedule.IntervalMs <= 0 {
			continue
		}
		id := rowid.New()
		err = queries.InsertJob(ctx, dbgen.InsertJobParams{
			ID: id, Kind: schedule.Kind, Args: []byte("{}"), MaxAttempts: int32(entry.opts.MaxAttempts), NotBefore: now, Now: now,
		})
		if err != nil {
			return err
		}
		err = queries.AdvanceSchedule(ctx, dbgen.AdvanceScheduleParams{
			NextDue: now.Add(time.Duration(schedule.IntervalMs) * time.Millisecond), LastJobID: &id, Kind: schedule.Kind,
		})
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
