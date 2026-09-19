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
	// A second reader at the same instant sees the same rate.
	if got := read(); got != 30 {
		t.Errorf("read again = %v/min, want 30", got)
	}
	total, now = 65, now.Add(60*time.Second)
	if got := read(); got != 65*60/70.0 {
		t.Errorf("65 calls in 70 s = %v/min, want %v", got, 65*60/70.0)
	}
	// A minute later with no calls, the old growth has left the window.
	now = now.Add(60 * time.Second)
	if got := read(); got != 0 {
		t.Errorf("quiet minute = %v/min, want 0", got)
	}
	// A restart of the counter reads as 0 rather than a negative rate.
	total, now = 1, now.Add(10*time.Second)
	if got := read(); got != 0 {
		t.Errorf("counter went backwards = %v, want 0", got)
	}
}
