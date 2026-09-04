package auth

import (
	"testing"
	"time"
)

func TestLoginGuardLocksAfterThresholdAndBacksOff(t *testing.T) {
	g := newLoginGuard()
	now := time.Unix(1_700_000_000, 0)
	g.now = func() time.Time { return now }

	for i := range lockoutThreshold - 1 {
		g.failure("ada")
		if w := g.check("ada"); w != 0 {
			t.Fatalf("locked after %d failures (%v), threshold is %d", i+1, w, lockoutThreshold)
		}
	}
	g.failure("ada")
	if w := g.check("ada"); w != lockoutBase {
		t.Fatalf("after threshold wait = %v, want %v", w, lockoutBase)
	}
	if g.check("other") != 0 {
		t.Fatal("lockout must be per username")
	}
	// Waiting it out, then failing again, doubles the delay.
	now = now.Add(lockoutBase + time.Second)
	if g.check("ada") != 0 {
		t.Fatal("lock should have expired")
	}
	g.failure("ada")
	if w := g.check("ada"); w != 2*lockoutBase {
		t.Fatalf("second lock wait = %v, want %v", w, 2*lockoutBase)
	}
	// ...and never beyond the cap.
	for range 20 {
		now = now.Add(lockoutMax + time.Second)
		g.failure("ada")
	}
	if w := g.check("ada"); w != lockoutMax {
		t.Fatalf("capped wait = %v, want %v", w, lockoutMax)
	}
	g.success("ada")
	if g.check("ada") != 0 {
		t.Fatal("success must clear the lock")
	}
}

func TestLoginGuardBounded(t *testing.T) {
	g := newLoginGuard()
	now := time.Unix(1_700_000_000, 0)
	g.now = func() time.Time { return now }
	for i := range lockoutMaxEntries + 10 {
		g.failure(string(rune('a'+i%26)) + string(rune(i)))
	}
	if n := len(g.entries); n > lockoutMaxEntries {
		t.Fatalf("entries = %d, exceeds cap %d", n, lockoutMaxEntries)
	}
	// Idle entries are pruned on the next GC tick.
	now = now.Add(lockoutIdle + 2*time.Minute)
	g.failure("fresh")
	if n := len(g.entries); n != 1 {
		t.Fatalf("after idle GC entries = %d, want 1", n)
	}
}
