package app_test

import (
	"testing"
	"time"
)

// Clean now on the Storage tab: a member is refused, the admin gets a job
// id back at once, and the dispatcher runs the sweep soon after, so the
// Background work panel shows a succeeded sweep_files pass with its
// counters.
func TestE2ESweepFilesEnqueues(t *testing.T) {
	h := newHarness(t, "STOOP_JOBS_POLL", "100ms")
	casey := h.person("casey")
	ada := h.person("ada")

	const sweep = "stoop.files.v1.FileService/SweepFiles"
	h.rpc(ada, sweep, map[string]any{}).expect(t, "permission_denied")
	queued := h.rpc(casey, sweep, map[string]any{}).expect(t, "ok")
	if queued.str("jobId") == "" {
		t.Fatalf("no jobId: %s", queued.raw)
	}

	row := h.awaitJobOutcome(casey, "sweep_files", "JOB_OUTCOME_SUCCEEDED", 10*time.Second)
	if row["lastStarted"] == nil {
		t.Errorf("sweep_files has no lastStarted: %v", row)
	}
	counters, _ := row["counters"].(map[string]any)
	if _, ok := counters["files_removed"]; !ok {
		t.Errorf("sweep_files counters = %v, want files_removed", counters)
	}
}

// awaitJobOutcome polls ListJobs until the named job's last outcome is
// the one wanted, or fails after the deadline with the last row seen.
func (h *harness) awaitJobOutcome(token, name, outcome string, deadline time.Duration) map[string]any {
	h.t.Helper()
	var last map[string]any
	until := time.Now().Add(deadline)
	for time.Now().Before(until) {
		last = jobRow(h.rpc(token, diagnostics+"ListJobs", map[string]any{}).expect(h.t, "ok"), name)
		if last != nil && last["lastOutcome"] == outcome {
			return last
		}
		time.Sleep(100 * time.Millisecond)
	}
	h.t.Fatalf("%s did not reach %s in %s; last seen %v", name, outcome, deadline, last)
	return nil
}

// jobRow finds one job's row in a ListJobs reply, or nil.
func jobRow(response reply, name string) map[string]any {
	for _, job := range response.list("jobs") {
		row, _ := job.(map[string]any)
		if row["name"] == name {
			return row
		}
	}
	return nil
}
