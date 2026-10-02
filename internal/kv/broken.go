package kv

import (
	"context"
	"time"
)

// Broken is a backend whose every store answers err, for tests of what a
// caller does when its store cannot answer.
func Broken(err error) Backend { return brokenBackend{err} }

type brokenBackend struct{ err error }

func (b brokenBackend) Open(string, int) Store[any] { return brokenStore(b) }

type brokenStore struct{ err error }

func (s brokenStore) Get(context.Context, string) (any, bool, error) { return nil, false, s.err }

func (s brokenStore) Set(context.Context, string, any, time.Duration) error { return s.err }

func (s brokenStore) Update(context.Context, string, func(any, bool) (any, time.Duration, bool)) error {
	return s.err
}

func (s brokenStore) Delete(context.Context, string) error { return s.err }

func (s brokenStore) Len(context.Context) (int, error) { return 0, s.err }
