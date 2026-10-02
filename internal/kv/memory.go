package kv

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// Memory is the in-process backend: one map per store, swept on write.
type Memory struct {
	now func() time.Time

	mu     sync.Mutex
	stores map[string]*memoryStore
}

// NewMemory returns an in-process backend. now is the clock; nil means
// time.Now.
func NewMemory(now func() time.Time) *Memory {
	if now == nil {
		now = time.Now
	}
	return &Memory{now: now, stores: map[string]*memoryStore{}}
}

// Open returns a new store. A name opened twice or a cap under one is a
// wiring mistake and stops the program.
func (m *Memory) Open(name string, cap int) Store[any] {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, taken := m.stores[name]; taken {
		panic(fmt.Sprintf("kv: store %q opened twice", name))
	}
	if cap < 1 {
		panic(fmt.Sprintf("kv: store %q opened with cap %d", name, cap))
	}
	store := &memoryStore{cap: cap, now: m.now, entries: map[string]memoryEntry{}}
	m.stores[name] = store
	return store
}

// Each visits every opened store by name, for registering gauges.
func (m *Memory) Each(visit func(name string, store Store[any])) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for name, store := range m.stores {
		visit(name, store)
	}
}

// sweepEvery bounds how often a write pays for a full scan.
const sweepEvery = time.Minute

// evictSample is how many entries a full store looks at to pick the one
// to evict. A full scan per new key would make a flood of keys cost a
// walk of the whole store each; a sample keeps the cost flat, and a map
// iteration starts somewhere different every time.
const evictSample = 16

type memoryStore struct {
	cap int
	now func() time.Time

	mu        sync.Mutex
	entries   map[string]memoryEntry
	lastSweep time.Time
}

type memoryEntry struct {
	value   any
	expires time.Time
}

func (s *memoryStore) Get(_ context.Context, key string) (any, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, found := s.liveLocked(key)
	return entry.value, found, nil
}

func (s *memoryStore) Set(_ context.Context, key string, value any, ttl time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked()
	if _, found := s.liveLocked(key); !found {
		s.makeRoomLocked()
	}
	s.entries[key] = memoryEntry{value: value, expires: s.now().Add(ttl)}
	return nil
}

func (s *memoryStore) Update(_ context.Context, key string, change func(current any, found bool) (any, time.Duration, bool)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked()
	entry, found := s.liveLocked(key)
	next, ttl, keep := change(entry.value, found)
	if !keep {
		delete(s.entries, key)
		return nil
	}
	if !found {
		if ttl <= 0 {
			return ErrNoTTL
		}
		s.makeRoomLocked()
	}
	if ttl > 0 {
		entry.expires = s.now().Add(ttl)
	}
	entry.value = next
	s.entries[key] = entry
	return nil
}

func (s *memoryStore) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.entries, key)
	return nil
}

func (s *memoryStore) Len(_ context.Context) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dropExpiredLocked()
	return len(s.entries), nil
}

// liveLocked returns the entry under key unless it has expired, in which
// case it is dropped on the way.
func (s *memoryStore) liveLocked(key string) (memoryEntry, bool) {
	entry, found := s.entries[key]
	if !found {
		return memoryEntry{}, false
	}
	if !s.now().Before(entry.expires) {
		delete(s.entries, key)
		return memoryEntry{}, false
	}
	return entry, true
}

func (s *memoryStore) sweepLocked() {
	now := s.now()
	if now.Sub(s.lastSweep) < sweepEvery {
		return
	}
	s.lastSweep = now
	s.dropExpiredLocked()
}

func (s *memoryStore) dropExpiredLocked() {
	now := s.now()
	for key, entry := range s.entries {
		if !now.Before(entry.expires) {
			delete(s.entries, key)
		}
	}
}

// makeRoomLocked frees a slot for a new key when the store is full. An
// expired entry in the sample goes first; failing that, the one nearest
// its expiry, since it is the one with least left to say.
func (s *memoryStore) makeRoomLocked() {
	if len(s.entries) < s.cap {
		return
	}
	now := s.now()
	var soonestKey string
	var soonest time.Time
	seen := 0
	for key, entry := range s.entries {
		if !now.Before(entry.expires) {
			delete(s.entries, key)
			return
		}
		if seen == 0 || entry.expires.Before(soonest) {
			soonestKey, soonest = key, entry.expires
		}
		seen++
		if seen == evictSample {
			break
		}
	}
	delete(s.entries, soonestKey)
}
