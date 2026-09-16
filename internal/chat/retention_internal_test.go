package chat

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

// A message made at t sorts after the cutoff for any earlier instant and
// before the cutoff for any later one.
func TestCutoffIDOrdersByTime(t *testing.T) {
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatal(err)
	}
	sec, nsec := id.Time().UnixTime()
	made := time.Unix(sec, nsec)
	if before := cutoffID(made.Add(-time.Millisecond)); id.String() <= before {
		t.Errorf("id %s sorts before the cutoff for an earlier instant %s", id, before)
	}
	if after := cutoffID(made.Add(time.Millisecond)); id.String() >= after {
		t.Errorf("id %s sorts after the cutoff for a later instant %s", id, after)
	}
}
