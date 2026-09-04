package files

import (
	"fmt"
	"sync"
)

// MaxInflightUploads bounds one account's concurrent attachment uploads.
// The quota is enforced when a file is recorded, after its bytes have been
// spooled, so without this bound N parallel requests could hold N times
// the per-file cap on disk before any of them is refused.
const MaxInflightUploads = 3

var tooManyUploadsMessage = fmt.Sprintf("at most %d uploads at a time; wait for one to finish", MaxInflightUploads)

type inflight struct {
	mu    sync.Mutex
	limit int
	byKey map[string]int
}

func newInflight(limit int) *inflight {
	return &inflight{limit: limit, byKey: map[string]int{}}
}

func (i *inflight) acquire(key string) bool {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.byKey[key] >= i.limit {
		return false
	}
	i.byKey[key]++
	return true
}

func (i *inflight) release(key string) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.byKey[key] <= 1 {
		delete(i.byKey, key)
		return
	}
	i.byKey[key]--
}
