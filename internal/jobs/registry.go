package jobs

import (
	"cmp"
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
	ID   string
	Kind string
	// Attempt is this try, from 1; MaxAttempts is the kind's limit, so a
	// performer can tell its last try from the rest.
	Attempt     int
	MaxAttempts int

	args     []byte
	extend   func(ctx context.Context, until time.Time) error
	now      func() time.Time
	mu       sync.Mutex
	counters Counters
}

// Args decodes the JSON arguments into the value pointed to.
func (j *Job) Args(into any) error {
	if len(j.args) == 0 {
		return nil
	}
	if err := json.Unmarshal(j.args, into); err != nil {
		return fmt.Errorf("decode %s args: %w", j.Kind, err)
	}
	return nil
}

// Record attaches counters to the row; they are written with the outcome.
func (j *Job) Record(counters Counters) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.counters == nil {
		j.counters = Counters{}
	}
	maps.Copy(j.counters, counters)
}

// Extend moves the lease deadline to now + lease when that is later.
func (j *Job) Extend(ctx context.Context, lease time.Duration) error {
	if j.extend == nil {
		return nil
	}
	return j.extend(ctx, j.now().Add(lease))
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

// Options is a kind's retry policy and its concurrency cap; a zero field
// takes its default.
type Options struct {
	// MaxAttempts is how many tries before the job is discarded.
	MaxAttempts int
	// Backoff is the wait before attempts 2, 3, …; the last wait repeats.
	Backoff []time.Duration
	// MaxInFlight caps how many rows of the kind hold a live lease at once,
	// across every dispatcher; 0 is no cap. See
	// docs/architecture/runtime.md → Background work.
	MaxInFlight int
}

func (o Options) withDefaults() Options {
	if o.MaxAttempts <= 0 {
		o.MaxAttempts = DefaultMaxAttempts
	}
	if len(o.Backoff) == 0 {
		o.Backoff = DefaultBackoff
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
// arguments into A. Registering a kind twice, or with a negative
// MaxInFlight, panics.
func Register[A any](registry *Registry, kind string, fn func(ctx context.Context, job *Job, args A) error, opts Options) {
	if opts.MaxInFlight < 0 {
		panic(fmt.Sprintf("jobs: kind %q has a negative MaxInFlight", kind))
	}
	perform := performFunc(func(ctx context.Context, job *Job) error {
		var args A
		if err := job.Args(&args); err != nil {
			return Discard(err)
		}
		return fn(ctx, job, args)
	})
	registry.mu.Lock()
	defer registry.mu.Unlock()
	if _, taken := registry.kinds[kind]; taken {
		panic(fmt.Sprintf("jobs: kind %q registered twice", kind))
	}
	registry.kinds[kind] = kindEntry{performer: perform, opts: opts.withDefaults()}
}

// Kinds lists the registered kinds, sorted.
func (r *Registry) Kinds() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return slices.Sorted(maps.Keys(r.kinds))
}

// cappedKind is a kind registered with a MaxInFlight.
type cappedKind struct {
	kind        string
	maxInFlight int
}

// uncappedKinds lists the kinds with no MaxInFlight, sorted.
func (r *Registry) uncappedKinds() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	kinds := make([]string, 0, len(r.kinds))
	for kind, entry := range r.kinds {
		if entry.opts.MaxInFlight <= 0 {
			kinds = append(kinds, kind)
		}
	}
	slices.Sort(kinds)
	return kinds
}

// cappedKinds lists the kinds with a MaxInFlight and their caps, sorted by kind.
func (r *Registry) cappedKinds() []cappedKind {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var kinds []cappedKind
	for kind, entry := range r.kinds {
		if entry.opts.MaxInFlight > 0 {
			kinds = append(kinds, cappedKind{kind: kind, maxInFlight: entry.opts.MaxInFlight})
		}
	}
	slices.SortFunc(kinds, func(left, right cappedKind) int { return cmp.Compare(left.kind, right.kind) })
	return kinds
}

func (r *Registry) lookup(kind string) (kindEntry, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	entry, ok := r.kinds[kind]
	return entry, ok
}
