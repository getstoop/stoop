package app

import (
	"strings"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/diag"
	"github.com/getstoop/stoop/internal/instance"
)

func TestWebhooksState(t *testing.T) {
	now := time.Now()
	tests := []struct {
		name   string
		q      instance.QueueStats
		worker time.Time
		want   instance.CheckState
		detail string
	}{
		{"no hooks", instance.QueueStats{}, now, instance.CheckOff, "no outgoing webhooks"},
		{"idle", instance.QueueStats{Hooks: 2}, now.Add(-3 * time.Second), instance.CheckOK, "0 queued · none dead-lettered in the last hour"},
		{"busy", instance.QueueStats{Hooks: 2, Queued: 7}, now.Add(-3 * time.Second), instance.CheckOK, "7 queued"},
		{"dead", instance.QueueStats{Hooks: 2, DeadLastHour: 1, Dead: 9}, now, instance.CheckWarn, "1 delivery dead-lettered in the last hour"},
		{"dead many", instance.QueueStats{Hooks: 2, DeadLastHour: 4}, now, instance.CheckWarn, "4 deliveries dead-lettered"},
		{"worker stuck", instance.QueueStats{Hooks: 2, Queued: 3, DeadLastHour: 1}, now.Add(-7 * time.Minute), instance.CheckDanger, "3 queued and the worker has not run for 7 min"},
		{"worker stuck, nothing queued", instance.QueueStats{Hooks: 2}, now.Add(-time.Hour), instance.CheckOK, "0 queued"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			state, detail := webhooksState(tc.q, tc.worker, now)
			if state != tc.want || !strings.Contains(detail, tc.detail) {
				t.Errorf("got %d %q, want %d containing %q", state, detail, tc.want, tc.detail)
			}
		})
	}
}

func TestWorkerLast(t *testing.T) {
	now := time.Now()
	started := now.Add(-time.Hour)
	stuck := diag.JobRecord{Name: workerJob, Continuous: true, LastStarted: now.Add(-2 * time.Second), LastSuccess: now.Add(-9 * time.Minute), Outcome: diag.Failed, LastError: "lease: connection refused"}
	if got := workerLast([]diag.JobRecord{stuck}, started); !got.Equal(stuck.LastSuccess) {
		t.Errorf("a failing pass counts as a run: got %v, want %v", got, stuck.LastSuccess)
	}
	if state, detail := webhooksState(instance.QueueStats{Hooks: 1, Queued: 2}, workerLast([]diag.JobRecord{stuck}, started), now); state != instance.CheckDanger || !strings.Contains(detail, "has not run for 9 min") {
		t.Errorf("got %d %q, want danger", state, detail)
	}
	never := diag.JobRecord{Name: workerJob, Continuous: true, LastStarted: now, Outcome: diag.Failed}
	if got := workerLast([]diag.JobRecord{never}, started); !got.Equal(started) {
		t.Errorf("never succeeded: got %v, want process start %v", got, started)
	}
	if got := workerLast(nil, started); !got.Equal(started) {
		t.Errorf("no record: got %v, want %v", got, started)
	}
}

func TestJobsState(t *testing.T) {
	now := time.Now()
	hour := time.Hour
	scheduled := func(name string, last time.Time, outcome diag.Outcome) diag.JobRecord {
		r := diag.JobRecord{Name: name, Interval: hour, LastStarted: last, Outcome: outcome}
		if !last.IsZero() {
			r.NextDue = last.Add(hour)
		}
		return r
	}
	fresh := scheduled("file_sweep", now.Add(-12*time.Minute), diag.Succeeded)
	tests := []struct {
		name   string
		jobs   []diag.JobRecord
		want   instance.CheckState
		detail string
	}{
		{"just started", []diag.JobRecord{scheduled("file_sweep", time.Time{}, diag.NeverRan), {Name: "webhook_worker", Continuous: true}},
			instance.CheckOK, "1 jobs on schedule · none run yet"},
		{"on schedule", []diag.JobRecord{fresh, scheduled("credential_sweep", now.Add(-50*time.Minute), diag.Succeeded)},
			instance.CheckOK, "2 jobs on schedule · last ran 12 min ago"},
		{"failed", []diag.JobRecord{fresh, func() diag.JobRecord {
			r := scheduled("message_retention", now.Add(-5*time.Minute), diag.Failed)
			r.LastError = "list expired messages: timeout"
			return r
		}()}, instance.CheckWarn, "message_retention failed: list expired messages: timeout"},
		{"one interval late", []diag.JobRecord{fresh, scheduled("activity_retention", now.Add(-190*time.Minute), diag.Succeeded)},
			instance.CheckWarn, "activity_retention overdue by 2 h"},
		{"three intervals late", []diag.JobRecord{fresh, scheduled("activity_retention", now.Add(-5*hour), diag.Succeeded)},
			instance.CheckDanger, "activity_retention overdue by 4 h"},
		{"danger beats a failure", []diag.JobRecord{
			scheduled("credential_sweep", now.Add(-time.Minute), diag.Failed),
			scheduled("activity_retention", now.Add(-5*hour), diag.Succeeded),
		}, instance.CheckDanger, "activity_retention overdue"},
		{"continuous is skipped", []diag.JobRecord{fresh, {Name: "webhook_worker", Continuous: true, Outcome: diag.Failed, LastError: "boom"}},
			instance.CheckOK, "1 jobs on schedule"},
		{"off is counted apart", []diag.JobRecord{fresh, {Name: "file_sweep"}, {Name: "activity_retention"}},
			instance.CheckOK, "1 jobs on schedule · 2 off · last ran 12 min ago"},
		{"off before any run", []diag.JobRecord{scheduled("credential_sweep", time.Time{}, diag.NeverRan), {Name: "file_sweep"}},
			instance.CheckOK, "1 jobs on schedule · 1 off · none run yet"},
		{"all on", []diag.JobRecord{fresh}, instance.CheckOK, "1 jobs on schedule · last ran 12 min ago"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			state, detail := jobsState(tc.jobs, now)
			if state != tc.want || !strings.Contains(detail, tc.detail) {
				t.Errorf("got %d %q, want %d containing %q", state, detail, tc.want, tc.detail)
			}
		})
	}
}
