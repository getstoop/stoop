package pbtime

import (
	"testing"
	"time"
)

func TestOrNil(t *testing.T) {
	if got := OrNil(nil); got != nil {
		t.Errorf("OrNil(nil) = %v", got)
	}
	at := time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)
	if got := OrNil(&at); !got.AsTime().Equal(at) {
		t.Errorf("OrNil = %v, want %v", got.AsTime(), at)
	}
}

func TestOrZero(t *testing.T) {
	if got := OrZero(time.Time{}); got != nil {
		t.Errorf("OrZero(zero) = %v", got)
	}
	at := time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)
	if got := OrZero(at); !got.AsTime().Equal(at) {
		t.Errorf("OrZero = %v, want %v", got.AsTime(), at)
	}
}
