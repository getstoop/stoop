package auth

import (
	"context"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/kv"
)

// testGuard is a guard whose clock, shared with its store, the test moves.
func testGuard() (*loginGuard, *time.Time) {
	at := time.Unix(1_700_000_000, 0)
	now := func() time.Time { return at }
	guard := newLoginGuard(kv.NewMemory(now))
	guard.now = now
	return guard, &at
}

func TestLoginGuardLocksAfterThresholdAndBacksOff(t *testing.T) {
	ctx := context.Background()
	guard, now := testGuard()
	wait := func(username string) time.Duration {
		t.Helper()
		wait, err := guard.check(ctx, username)
		if err != nil {
			t.Fatal(err)
		}
		return wait
	}
	fail := func(username string) {
		t.Helper()
		if err := guard.failure(ctx, username); err != nil {
			t.Fatal(err)
		}
	}

	for attempt := range lockoutThreshold - 1 {
		fail("ada")
		if locked := wait("ada"); locked != 0 {
			t.Fatalf("locked after %d failures (%v), threshold is %d", attempt+1, locked, lockoutThreshold)
		}
	}
	fail("ada")
	if locked := wait("ada"); locked != lockoutBase {
		t.Fatalf("after threshold wait = %v, want %v", locked, lockoutBase)
	}
	if wait("other") != 0 {
		t.Fatal("lockout must be per username")
	}
	// Waiting it out, then failing again, doubles the delay.
	*now = now.Add(lockoutBase + time.Second)
	if wait("ada") != 0 {
		t.Fatal("lock should have expired")
	}
	fail("ada")
	if locked := wait("ada"); locked != 2*lockoutBase {
		t.Fatalf("second lock wait = %v, want %v", locked, 2*lockoutBase)
	}
	// ...and never beyond the cap.
	for range 20 {
		*now = now.Add(lockoutMax + time.Second)
		fail("ada")
	}
	if locked := wait("ada"); locked != lockoutMax {
		t.Fatalf("capped wait = %v, want %v", locked, lockoutMax)
	}
	if err := guard.success(ctx, "ada"); err != nil {
		t.Fatal(err)
	}
	if wait("ada") != 0 {
		t.Fatal("success must clear the lock")
	}
}

func TestLoginGuardBounded(t *testing.T) {
	ctx := context.Background()
	guard, now := testGuard()
	for index := range lockoutMaxEntries + 10 {
		if err := guard.failure(ctx, string(rune('a'+index%26))+string(rune(index))); err != nil {
			t.Fatal(err)
		}
	}
	if count, _ := guard.entries.Len(ctx); count > lockoutMaxEntries {
		t.Fatalf("entries = %d, exceeds cap %d", count, lockoutMaxEntries)
	}
	// Idle entries are gone after lockoutIdle.
	*now = now.Add(lockoutIdle + 2*time.Minute)
	if err := guard.failure(ctx, "fresh"); err != nil {
		t.Fatal(err)
	}
	if count, _ := guard.entries.Len(ctx); count != 1 {
		t.Fatalf("after the idle ttl entries = %d, want 1", count)
	}
}
