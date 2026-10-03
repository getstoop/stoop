package jobs

import (
	"context"
	"time"
)

// Counters is what a run reports: files_removed, bytes_freed …
type Counters map[string]int64

// NoArgs is the argument type of a kind that takes none.
type NoArgs struct{}

// Job is what a performer is handed.
type Job struct {
	ID      string
	Kind    string
	Attempt int
}

// Args decodes the JSON arguments into v.
func (j *Job) Args(v any) error { panic("jobs: not built") }

// Record attaches counters to the row; they are written with the outcome.
func (j *Job) Record(c Counters) { panic("jobs: not built") }

// Extend moves the lease deadline to now + d, for a pass that outlives
// the kind's lease.
func (j *Job) Extend(ctx context.Context, d time.Duration) error { panic("jobs: not built") }

// Performer does the work. nil is success; an error is a failure the
// dispatcher retries by the kind's Options, unless RetryIn or Discard
// wrapped it.
type Performer interface {
	Perform(ctx context.Context, job *Job) error
}

// Options is a kind's retry policy; a zero field takes its default.
type Options struct {
	// MaxAttempts is how many tries before the job is discarded.
	MaxAttempts int
	// Backoff is the wait before attempts 2, 3, …; the last wait repeats.
	Backoff []time.Duration
	// Lease is how long one attempt may run before another worker may
	// claim the row.
	Lease time.Duration
}

// Registry binds kinds to performers.
type Registry struct{}

func NewRegistry() *Registry { panic("jobs: not built") }

// Register binds kind to a typed performer; the wrapper decodes the JSON
// arguments into A. Registering a kind twice panics.
func Register[A any](r *Registry, kind string, fn func(ctx context.Context, job *Job, args A) error, opts Options) {
	panic("jobs: not built")
}

// Kinds lists the registered kinds, sorted.
func (r *Registry) Kinds() []string { panic("jobs: not built") }
