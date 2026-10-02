package files

import (
	"fmt"
	"sync"
)

// MaxInflightUploads bounds one account's concurrent attachment uploads.
// The slot is taken before the body is read, so an account has at most this
// many bodies spooled to disk at once; the quota is only checked afterwards.
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
