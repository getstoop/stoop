package jobs

import "sync"

// inflight is the set of rows this dispatcher has leased and not yet
// written an outcome for. Whoever removes an id first owns the row's
// next write: the worker finishing it, or shutdown releasing it.
type inflight struct {
	mu  sync.Mutex
	ids map[string]bool
}

func newInflight() *inflight { return &inflight{ids: map[string]bool{}} }

func (f *inflight) add(id string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ids[id] = true
}

func (f *inflight) remove(id string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	present := f.ids[id]
	delete(f.ids, id)
	return present
}

func (f *inflight) drain() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	ids := make([]string, 0, len(f.ids))
	for id := range f.ids {
		ids = append(ids, id)
	}
	f.ids = map[string]bool{}
	return ids
}

func (f *inflight) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.ids)
}
