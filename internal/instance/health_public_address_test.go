package instance

import (
	"testing"
	"time"
)

// A stopped tunnel or tailnet is a warning until it has been down for a
// minute, and a sighting of it running resets the clock.
func TestPublicAddressDown(t *testing.T) {
	c := &publicAddressCheck{}
	t0 := time.Date(2026, 9, 19, 12, 0, 0, 0, time.UTC)
	if st := c.down(t0); st != CheckWarn {
		t.Errorf("first sighting = %d, want warn", st)
	}
	if st := c.down(t0.Add(59 * time.Second)); st != CheckWarn {
		t.Errorf("at 59 s = %d, want warn", st)
	}
	if st := c.down(t0.Add(time.Minute)); st != CheckDanger {
		t.Errorf("at 60 s = %d, want danger", st)
	}
	c.up()
	if st := c.down(t0.Add(2 * time.Minute)); st != CheckWarn {
		t.Errorf("after a recovery = %d, want warn", st)
	}
}
