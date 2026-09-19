package app

import (
	"testing"
	"time"
)

func TestPerMinute(t *testing.T) {
	total, now := int64(0), time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	read := perMinute(func() int64 { return total }, func() time.Time { return now })

	if got := read(); got != 0 {
		t.Errorf("first read = %v, want 0", got)
	}
	total, now = 5, now.Add(10*time.Second)
	if got := read(); got != 30 {
		t.Errorf("5 calls in 10 s = %v/min, want 30", got)
	}
	total, now = 5, now.Add(10*time.Second)
	if got := read(); got != 0 {
		t.Errorf("no calls = %v/min, want 0", got)
	}
	total, now = 8, now.Add(time.Minute)
	if got := read(); got != 3 {
		t.Errorf("3 calls in 1 min = %v/min, want 3", got)
	}
	// A read with no time passed cannot divide by zero.
	total = 9
	if got := read(); got != 0 {
		t.Errorf("same instant = %v, want 0", got)
	}
}
