package jobs

import (
	"context"
	"time"
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
	panic("jobs: not built")
}

// Schedules lists every schedule row with its latest run, sorted by kind.
func (s *Service) Schedules(ctx context.Context) ([]Schedule, error) { panic("jobs: not built") }
