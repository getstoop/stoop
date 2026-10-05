package jobs

import (
	"slices"
	"testing"
)

// A claimed row stays out of the lease query until its outcome is written,
// and shutdown no longer releases it.
func TestClaimedRowStaysExcludedButIsNotDrained(t *testing.T) {
	tracked := newInflight()
	tracked.add("finished", 1)
	tracked.add("running", 1)
	if !tracked.claim("finished") {
		t.Fatal("a tracked row could not be claimed")
	}
	if ids := tracked.ids(); !slices.Contains(ids, "finished") || tracked.count() != 2 {
		t.Errorf("a claimed row left the lease exclusion: ids %v, count %d", ids, tracked.count())
	}
	if ids, _ := tracked.drain(); !slices.Equal(ids, []string{"running"}) {
		t.Errorf("drain returned %v, want only the unclaimed row", ids)
	}
	if tracked.claim("running") {
		t.Error("a drained row was claimed")
	}
	tracked.done("finished")
	if tracked.count() != 0 || len(tracked.ids()) != 0 {
		t.Errorf("rows left after done: %v", tracked.ids())
	}
}
