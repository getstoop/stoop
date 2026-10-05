package jobs

import (
	"maps"
	"slices"
	"sync"
)

// inflight is the set of rows this dispatcher has leased and not yet
// written an outcome for, each with the attempt it was leased for.
// Whoever takes an id first owns the row's next write: the worker
// finishing it (claim), or shutdown releasing it (drain).
type inflight struct {
	mu       sync.Mutex
	attempts map[string]int32
	// writing holds rows a worker has claimed and is writing the outcome
	// for: still kept from the lease query, no longer shutdown's to release.
	writing map[string]bool
}

func newInflight() *inflight {
	return &inflight{attempts: map[string]int32{}, writing: map[string]bool{}}
}

func (f *inflight) add(id string, attempt int32) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.attempts[id] = attempt
}

func (f *inflight) remove(id string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, present := f.attempts[id]
	delete(f.attempts, id)
	return present
}

// claim takes a finished row's outcome write for its worker; false when
// shutdown released the row first. The row stays out of the lease query
// until done, so a lapsed lease cannot hand it to this dispatcher again
// before its outcome is written.
func (f *inflight) claim(id string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, present := f.attempts[id]; !present {
		return false
	}
	delete(f.attempts, id)
	f.writing[id] = true
	return true
}

// done ends a claim once the outcome is written.
func (f *inflight) done(id string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.writing, id)
}

// drain empties the set and returns the ids with their attempts, index
// for index.
func (f *inflight) drain() (ids []string, attempts []int32) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for id, attempt := range f.attempts {
		ids = append(ids, id)
		attempts = append(attempts, attempt)
	}
	f.attempts = map[string]int32{}
	return ids, attempts
}

// ids lists the rows in flight, claimed ones included, never nil: the
// lease query excludes them.
func (f *inflight) ids() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	ids := slices.AppendSeq(make([]string, 0, len(f.attempts)+len(f.writing)), maps.Keys(f.attempts))
	return slices.AppendSeq(ids, maps.Keys(f.writing))
}

func (f *inflight) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.attempts) + len(f.writing)
}
