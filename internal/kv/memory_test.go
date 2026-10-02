package kv

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

type clock struct{ at time.Time }

func (c *clock) now() time.Time { return c.at }

func (c *clock) advance(by time.Duration) { c.at = c.at.Add(by) }

func newClock() *clock { return &clock{at: time.Unix(1_700_000_000, 0)} }

func openCounter(t *testing.T, tick *clock, cap int) Store[int] {
	t.Helper()
	return Open[int](NewMemory(tick.now), "counters", cap)
}

func TestMemoryExpires(t *testing.T) {
	ctx := context.Background()
	tick := newClock()
	store := openCounter(t, tick, 10)

	if err := store.Set(ctx, "ada", 1, time.Minute); err != nil {
		t.Fatal(err)
	}
	if value, found, _ := store.Get(ctx, "ada"); !found || value != 1 {
		t.Fatalf("got %d, %v; want 1, true", value, found)
	}
	tick.advance(time.Minute)
	if _, found, _ := store.Get(ctx, "ada"); found {
		t.Fatal("entry should have expired at its ttl")
	}
	if count, _ := store.Len(ctx); count != 0 {
		t.Fatalf("len = %d after expiry, want 0", count)
	}
}

func TestMemoryUpdate(t *testing.T) {
	ctx := context.Background()
	tick := newClock()
	store := openCounter(t, tick, 10)
	increment := func(current int, _ bool) (int, time.Duration, bool) {
		return current + 1, time.Hour, true
	}

	for range 3 {
		if err := store.Update(ctx, "ada", increment); err != nil {
			t.Fatal(err)
		}
	}
	if value, _, _ := store.Get(ctx, "ada"); value != 3 {
		t.Fatalf("after three increments = %d, want 3", value)
	}

	// A zero ttl keeps the expiry the entry already has.
	tick.advance(30 * time.Minute)
	err := store.Update(ctx, "ada", func(current int, _ bool) (int, time.Duration, bool) {
		return current * 10, 0, true
	})
	if err != nil {
		t.Fatal(err)
	}
	tick.advance(30 * time.Minute)
	if _, found, _ := store.Get(ctx, "ada"); found {
		t.Fatal("an update with no ttl must not extend the entry")
	}

	// A new entry needs one.
	err = store.Update(ctx, "bea", func(int, bool) (int, time.Duration, bool) { return 1, 0, true })
	if !errors.Is(err, ErrNoTTL) {
		t.Fatalf("new entry without ttl: err = %v, want ErrNoTTL", err)
	}

	// keep=false deletes, and the change sees whether there was a value.
	_ = store.Set(ctx, "cal", 5, time.Hour)
	var saw int
	var sawFound bool
	err = store.Update(ctx, "cal", func(current int, found bool) (int, time.Duration, bool) {
		saw, sawFound = current, found
		return 0, 0, false
	})
	if err != nil {
		t.Fatal(err)
	}
	if saw != 5 || !sawFound {
		t.Fatalf("change saw %d, %v; want 5, true", saw, sawFound)
	}
	if _, found, _ := store.Get(ctx, "cal"); found {
		t.Fatal("keep=false must delete the entry")
	}
}

func TestMemoryCapEvictsSoonestToExpire(t *testing.T) {
	ctx := context.Background()
	tick := newClock()
	store := openCounter(t, tick, 3)

	_ = store.Set(ctx, "long", 1, time.Hour)
	_ = store.Set(ctx, "short", 2, time.Minute)
	_ = store.Set(ctx, "medium", 3, 10*time.Minute)
	if err := store.Set(ctx, "new", 4, time.Hour); err != nil {
		t.Fatal(err)
	}
	if count, _ := store.Len(ctx); count != 3 {
		t.Fatalf("len = %d, want the cap of 3", count)
	}
	if _, found, _ := store.Get(ctx, "short"); found {
		t.Fatal("the entry nearest expiry should have been evicted")
	}
	for _, key := range []string{"long", "medium", "new"} {
		if _, found, _ := store.Get(ctx, key); !found {
			t.Fatalf("%q should have survived", key)
		}
	}
	// Replacing a live key needs no room.
	if err := store.Set(ctx, "long", 10, time.Hour); err != nil {
		t.Fatal(err)
	}
	if count, _ := store.Len(ctx); count != 3 {
		t.Fatalf("len = %d after replacing a key, want 3", count)
	}
}

func TestMemoryCapPrefersExpiredEntries(t *testing.T) {
	ctx := context.Background()
	tick := newClock()
	store := openCounter(t, tick, 2)

	_ = store.Set(ctx, "stale", 1, time.Second)
	_ = store.Set(ctx, "fresh", 2, time.Hour)
	tick.advance(2 * time.Second)
	if err := store.Set(ctx, "new", 3, time.Hour); err != nil {
		t.Fatal(err)
	}
	if _, found, _ := store.Get(ctx, "fresh"); !found {
		t.Fatal("a live entry was evicted while an expired one could go")
	}
}

func TestMemorySweepsOnWrite(t *testing.T) {
	ctx := context.Background()
	tick := newClock()
	backend := NewMemory(tick.now)
	raw := backend.Open("tokens", 1000)
	store := Open[int](backend, "typed", 1000)

	for index := range 100 {
		_ = raw.Set(ctx, fmt.Sprint(index), index, time.Minute)
	}
	tick.advance(2 * time.Minute)
	_ = raw.Set(ctx, "later", 1, time.Minute)
	if count := len(raw.(*memoryStore).entries); count != 1 {
		t.Fatalf("map holds %d entries after a sweep, want 1", count)
	}
	if count, _ := store.Len(ctx); count != 0 {
		t.Fatalf("typed len = %d, want 0", count)
	}
}

func TestMemoryDeleteAndLen(t *testing.T) {
	ctx := context.Background()
	store := openCounter(t, newClock(), 10)
	_ = store.Set(ctx, "ada", 1, time.Hour)
	_ = store.Set(ctx, "bea", 2, time.Hour)
	if err := store.Delete(ctx, "ada"); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(ctx, "missing"); err != nil {
		t.Fatal(err)
	}
	if count, _ := store.Len(ctx); count != 1 {
		t.Fatalf("len = %d, want 1", count)
	}
}

func TestMemoryOpenTwicePanics(t *testing.T) {
	backend := NewMemory(nil)
	backend.Open("once", 1)
	defer func() {
		if recover() == nil {
			t.Fatal("opening a name twice should panic")
		}
	}()
	backend.Open("once", 1)
}

func TestMemoryEach(t *testing.T) {
	backend := NewMemory(nil)
	backend.Open("first", 1)
	backend.Open("second", 1)
	seen := map[string]bool{}
	backend.Each(func(name string, store Store[any]) {
		if store == nil {
			t.Fatalf("%q has no store", name)
		}
		seen[name] = true
	})
	if !seen["first"] || !seen["second"] {
		t.Fatalf("each visited %v", seen)
	}
}
