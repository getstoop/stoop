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
