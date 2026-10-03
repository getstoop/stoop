package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"sync"
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

	args     []byte
	extend   func(ctx context.Context, until time.Time) error
	now      func() time.Time
	mu       sync.Mutex
	counters Counters
}

// Args decodes the JSON arguments into v.
func (j *Job) Args(v any) error {
	if len(j.args) == 0 {
		return nil
	}
	if err := json.Unmarshal(j.args, v); err != nil {
		return fmt.Errorf("decode %s args: %w", j.Kind, err)
	}
	return nil
}

// Record attaches counters to the row; they are written with the outcome.
func (j *Job) Record(c Counters) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.counters == nil {
		j.counters = Counters{}
	}
	maps.Copy(j.counters, c)
}

// Extend moves the lease deadline to now + d, for a pass that outlives
// the kind's lease.
func (j *Job) Extend(ctx context.Context, d time.Duration) error {
	if j.extend == nil {
		return nil
	}
	return j.extend(ctx, j.now().Add(d))
}

func (j *Job) recorded() Counters {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.counters
}

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

func (o Options) withDefaults() Options {
	if o.MaxAttempts <= 0 {
		o.MaxAttempts = DefaultMaxAttempts
	}
	if len(o.Backoff) == 0 {
		o.Backoff = DefaultBackoff
	}
	if o.Lease <= 0 {
		o.Lease = DefaultLease
	}
	return o
}

type performFunc func(ctx context.Context, job *Job) error

func (fn performFunc) Perform(ctx context.Context, job *Job) error { return fn(ctx, job) }

type kindEntry struct {
	performer Performer
	opts      Options
}

// Registry binds kinds to performers.
type Registry struct {
	mu    sync.RWMutex
	kinds map[string]kindEntry
}

func NewRegistry() *Registry { return &Registry{kinds: map[string]kindEntry{}} }

// Register binds kind to a typed performer; the wrapper decodes the JSON
// arguments into A. Registering a kind twice panics.
func Register[A any](r *Registry, kind string, fn func(ctx context.Context, job *Job, args A) error, opts Options) {
	perform := performFunc(func(ctx context.Context, job *Job) error {
		var args A
		if err := job.Args(&args); err != nil {
			return Discard(err)
		}
		return fn(ctx, job, args)
	})
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, taken := r.kinds[kind]; taken {
		panic(fmt.Sprintf("jobs: kind %q registered twice", kind))
	}
	r.kinds[kind] = kindEntry{performer: perform, opts: opts.withDefaults()}
}

// Kinds lists the registered kinds, sorted.
func (r *Registry) Kinds() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return slices.Sorted(maps.Keys(r.kinds))
}

func (r *Registry) lookup(kind string) (kindEntry, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	entry, ok := r.kinds[kind]
	return entry, ok
}

// maxLease is the longest lease any registered kind asks for; the lease
// query claims every row with it.
func (r *Registry) maxLease() time.Duration {
	r.mu.RLock()
	defer r.mu.RUnlock()
	longest := DefaultLease
	for _, entry := range r.kinds {
		longest = max(longest, entry.opts.Lease)
	}
	return longest
}
