package auth

import (
	"context"
	"errors"
	"testing"
	"time"
)

// A hash waits for a free slot, and is refused as busy, not failed, when
// none frees in time; a caller that hangs up stops waiting.
func TestHashSlots(t *testing.T) {
	svc := &Service{hashSlots: make(chan struct{}, 1), hashWait: 50 * time.Millisecond}
	release, err := svc.takeHashSlot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.takeHashSlot(context.Background()); !errors.Is(err, errHashBusy) {
		t.Errorf("all slots held: got %v, want the busy refusal", err)
	}
	gone, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := svc.takeHashSlot(gone); !errors.Is(err, context.Canceled) {
		t.Errorf("caller gone: got %v, want context.Canceled", err)
	}
	release()
	again, err := svc.takeHashSlot(context.Background())
	if err != nil {
		t.Fatalf("a released slot is free again: %v", err)
	}
	again()
	if err := hashFailure("hash password", errHashBusy); err != errHashBusy {
		t.Errorf("the busy refusal is wrapped: %v", err)
	}
}
