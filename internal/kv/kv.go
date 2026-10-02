// Package kv is the home for keyed, short-lived state: a counter per
// username, a token per sign-in attempt, a bucket per client address.
// Every store has a cap and every entry an expiry, so memory is bounded
// however many keys a stranger invents.
//
// Stoop is one process, so the only backend is in memory. The interface
// still takes a context and returns an error so that a shared backend
// could be wired in from internal/app without touching a call site.
// docs/architecture/modules.md → Modules and support packages.
package kv

import (
	"context"
	"errors"
	"time"
)

// Store holds values of one type under string keys. A value is gone once
// its ttl passes, and a store never holds more than the cap it was opened
// with.
type Store[V any] interface {
	// Get returns the live value under key, and whether there was one.
	Get(ctx context.Context, key string) (V, bool, error)
	// Set stores value under key for ttl, replacing what was there.
	Set(ctx context.Context, key string, value V, ttl time.Duration) error
	// Update applies change to the value under key, atomically. change
	// gets the live value, or the zero value and false, and returns what to
	// store, its ttl and whether to keep it at all. A ttl of zero leaves the
	// entry's expiry as it was; a new entry has none, so it needs a ttl.
	Update(ctx context.Context, key string, change func(current V, found bool) (next V, ttl time.Duration, keep bool)) error
	// Delete removes the value under key, if any.
	Delete(ctx context.Context, key string) error
	// Len counts the live entries.
	Len(ctx context.Context) (int, error)
}

// Backend is what internal/app wires. Open returns the store named name,
// bounded to cap entries; the name is the store's namespace, and each is
// opened once.
type Backend interface {
	Open(name string, cap int) Store[any]
}

// ErrNoTTL is returned when an Update keeps a new entry without a ttl.
var ErrNoTTL = errors.New("kv: a new entry needs a ttl")

// Open returns the typed view of a backend's store.
func Open[V any](backend Backend, name string, cap int) Store[V] {
	return typed[V]{backend.Open(name, cap)}
}

type typed[V any] struct {
	raw Store[any]
}

func (s typed[V]) Get(ctx context.Context, key string) (V, bool, error) {
	var zero V
	value, found, err := s.raw.Get(ctx, key)
	if err != nil || !found {
		return zero, false, err
	}
	return value.(V), true, nil
}

func (s typed[V]) Set(ctx context.Context, key string, value V, ttl time.Duration) error {
	return s.raw.Set(ctx, key, value, ttl)
}

func (s typed[V]) Update(ctx context.Context, key string, change func(current V, found bool) (V, time.Duration, bool)) error {
	return s.raw.Update(ctx, key, func(current any, found bool) (any, time.Duration, bool) {
		var value V
		if found {
			value = current.(V)
		}
		return change(value, found)
	})
}

func (s typed[V]) Delete(ctx context.Context, key string) error {
	return s.raw.Delete(ctx, key)
}

func (s typed[V]) Len(ctx context.Context) (int, error) {
	return s.raw.Len(ctx)
}
