package app

import (
	"strings"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/diag"
	"github.com/getstoop/stoop/internal/instance"
	"github.com/getstoop/stoop/internal/jobs"
)

func TestWebhooksState(t *testing.T) {
	now := time.Now()
	tests := []struct {
		name   string
		stats  instance.QueueStats
		want   instance.CheckState
		detail string
	}{
		{"no hooks", instance.QueueStats{}, instance.CheckOff, "no outgoing webhooks"},
		{"idle", instance.QueueStats{Hooks: 2}, instance.CheckOK, "0 queued · none dead-lettered in the last hour"},
		{"busy", instance.QueueStats{Hooks: 2, Queued: 7, OldestDue: now.Add(-3 * time.Second)}, instance.CheckOK, "7 queued"},
		{"retry waiting its backoff", instance.QueueStats{Hooks: 2, Queued: 1, OldestDue: now.Add(2 * time.Minute)}, instance.CheckOK, "1 queued"},
		{"dead", instance.QueueStats{Hooks: 2, DeadLastHour: 1, Dead: 9}, instance.CheckWarn, "1 delivery dead-lettered in the last hour"},
		{"dead many", instance.QueueStats{Hooks: 2, DeadLastHour: 4}, instance.CheckWarn, "4 deliveries dead-lettered"},
		{"dispatcher stuck", instance.QueueStats{Hooks: 2, Queued: 3, DeadLastHour: 1, OldestDue: now.Add(-7 * time.Minute)}, instance.CheckDanger, "3 queued and the oldest has waited 7 min"},
		{"nothing queued", instance.QueueStats{Hooks: 2}, instance.CheckOK, "0 queued"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			state, detail := webhooksState(tc.stats, now)
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
		record := diag.JobRecord{Name: name, Interval: hour, LastStarted: last, Outcome: outcome}
		if !last.IsZero() {
			record.NextDue = last.Add(hour)
		}
		return record
	}
	fresh := scheduled("sweep_files", now.Add(-12*time.Minute), diag.Succeeded)
	tests := []struct {
		name   string
		jobs   []diag.JobRecord
		want   instance.CheckState
		detail string
	}{
		{"just started", []diag.JobRecord{scheduled("sweep_files", time.Time{}, diag.NeverRan)},
			instance.CheckOK, "1 jobs on schedule · none run yet"},
		{"on schedule", []diag.JobRecord{fresh, scheduled("sweep_credentials", now.Add(-50*time.Minute), diag.Succeeded)},
			instance.CheckOK, "2 jobs on schedule · last ran 12 min ago"},
		{"failed", []diag.JobRecord{fresh, func() diag.JobRecord {
			record := scheduled("sweep_messages", now.Add(-5*time.Minute), diag.Failed)
			record.LastError = "list expired messages: timeout"
			return record
		}()}, instance.CheckWarn, "sweep_messages failed: list expired messages: timeout"},
		{"one interval late", []diag.JobRecord{fresh, scheduled("sweep_activity", now.Add(-190*time.Minute), diag.Succeeded)},
			instance.CheckWarn, "sweep_activity overdue by 2 h"},
		{"three intervals late", []diag.JobRecord{fresh, scheduled("sweep_activity", now.Add(-5*hour), diag.Succeeded)},
			instance.CheckDanger, "sweep_activity overdue by 4 h"},
		{"danger beats a failure", []diag.JobRecord{
			scheduled("sweep_credentials", now.Add(-time.Minute), diag.Failed),
			scheduled("sweep_activity", now.Add(-5*hour), diag.Succeeded),
		}, instance.CheckDanger, "sweep_activity overdue"},
		{"off is counted apart", []diag.JobRecord{fresh, {Name: "sweep_files"}, {Name: "sweep_activity"}},
			instance.CheckOK, "1 jobs on schedule · 2 off · last ran 12 min ago"},
		{"off before any run", []diag.JobRecord{scheduled("sweep_credentials", time.Time{}, diag.NeverRan), {Name: "sweep_files"}},
			instance.CheckOK, "1 jobs on schedule · 1 off · none run yet"},
		{"off keeps its history", []diag.JobRecord{fresh, {Name: "sweep_activity", LastStarted: now.Add(-3 * hour), Outcome: diag.Succeeded}},
			instance.CheckOK, "1 jobs on schedule · 1 off · last ran 12 min ago"},
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

func TestJobsRunnerState(t *testing.T) {
	now := time.Now()
	seen := func(ago time.Duration) jobs.Dispatcher {
		return jobs.Dispatcher{ID: "d-" + ago.String(), Host: "box", Workers: 4, StartedAt: now.Add(-time.Hour), SeenAt: now.Add(-ago)}
	}
	tests := []struct {
		name        string
		dispatchers []jobs.Dispatcher
		want        instance.CheckState
		detail      string
	}{
		{"none", nil, instance.CheckDanger, "no dispatcher has registered"},
		{"fresh", []jobs.Dispatcher{seen(2 * time.Second)}, instance.CheckOK, "1 running · seen 2 s ago"},
		{"a stale one beside a fresh one", []jobs.Dispatcher{seen(3 * time.Second), seen(40 * time.Minute)}, instance.CheckOK, "1 running · seen 3 s ago"},
		{"just under a minute", []jobs.Dispatcher{seen(59 * time.Second)}, instance.CheckOK, "1 running · seen 59 s ago"},
		{"a minute", []jobs.Dispatcher{seen(time.Minute)}, instance.CheckWarn, "no dispatcher seen for 1 min"},
		{"just under five minutes", []jobs.Dispatcher{seen(5*time.Minute - time.Second)}, instance.CheckWarn, "no dispatcher seen for 4 min"},
		{"five minutes", []jobs.Dispatcher{seen(5 * time.Minute)}, instance.CheckDanger, "no dispatcher seen for 5 min"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			state, detail := jobsRunnerState(tc.dispatchers, now)
			if state != tc.want || !strings.Contains(detail, tc.detail) {
				t.Errorf("got %d %q, want %d containing %q", state, detail, tc.want, tc.detail)
			}
		})
	}
}
