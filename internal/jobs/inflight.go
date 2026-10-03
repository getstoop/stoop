package jobs

import "sync"

// inflight is the set of rows this dispatcher has leased and not yet
// written an outcome for, each with the attempt it was leased for.
// Whoever removes an id first owns the row's next write: the worker
// finishing it, or shutdown releasing it.
type inflight struct {
	mu       sync.Mutex
	attempts map[string]int32
}

func newInflight() *inflight { return &inflight{attempts: map[string]int32{}} }

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

func (f *inflight) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.attempts)
}
