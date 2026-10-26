package files

import (
	"context"
	"errors"
	"testing"
)

// The decode slot is given back when a decode panics, and a job waiting
// for it gives up when its context ends.
func TestDecodeSlot(t *testing.T) {
	svc := &Service{decodeSlot: make(chan struct{}, 1)}
	func() {
		defer func() { _ = recover() }()
		_ = svc.decodeOne(context.Background(), func() { panic("a decoder bug") })
	}()
	ran := false
	if err := svc.decodeOne(context.Background(), func() { ran = true }); err != nil || !ran {
		t.Fatalf("after a panic: ran %v, %v", ran, err)
	}

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	err := svc.decodeOne(context.Background(), func() {
		if err := svc.decodeOne(cancelled, func() { t.Error("ran while the slot was held") }); !errors.Is(err, context.Canceled) {
			t.Errorf("waiting with an ended context: %v", err)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
}
