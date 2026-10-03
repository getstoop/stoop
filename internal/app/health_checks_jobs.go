package app

import (
	"context"
	"fmt"
	"time"

	"github.com/getstoop/stoop/internal/diag"
	"github.com/getstoop/stoop/internal/instance"
	"github.com/getstoop/stoop/internal/jobs"
)

// The Health panel's last three rows, from the queue port, the job list
// and the heartbeat rows. Thresholds are the table in
// docs/architecture/diagnostics.md.

const (
	workerStale   = 5 * time.Minute
	runnerQuiet   = time.Minute
	overdueWarn   = 1
	overdueDanger = 3
)

// ---- webhooks ----

// newWebhooksCheck reads the delivery backlog and log through the shared
// cache.
func newWebhooksCheck(queue *queueStats) instance.HealthCheck {
	return instance.HealthCheck{Name: "webhooks", FixTab: "integrations", Run: func(ctx context.Context) (instance.CheckState, string) {
		stats, err := queue.stats(ctx)
		if err != nil {
			return instance.CheckDanger, err.Error()
		}
		return webhooksState(stats, time.Now())
	}}
}

// webhooksState is danger when a due delivery has waited workerStale: the
// dispatcher is not taking them.
func webhooksState(stats instance.QueueStats, now time.Time) (instance.CheckState, string) {
	if stats.Hooks == 0 {
		return instance.CheckOff, "no outgoing webhooks"
	}
	if waited := now.Sub(stats.OldestDue); stats.Queued > 0 && !stats.OldestDue.IsZero() && waited >= workerStale {
		return instance.CheckDanger, fmt.Sprintf("%d queued and the oldest has waited %s", stats.Queued, sinceWords(waited))
	}
	if stats.DeadLastHour > 0 {
		return instance.CheckWarn, fmt.Sprintf("%s dead-lettered in the last hour", plural(stats.DeadLastHour, "delivery", "deliveries"))
	}
	return instance.CheckOK, fmt.Sprintf("%d queued · none dead-lettered in the last hour", stats.Queued)
}

// ---- jobs ----

// newJobsCheck reads every job through the same list the Background work
// panel shows; a list that cannot be read is itself the finding.
func newJobsCheck(records func(ctx context.Context) ([]diag.JobRecord, error)) instance.HealthCheck {
	return instance.HealthCheck{Name: "jobs", Run: func(ctx context.Context) (instance.CheckState, string) {
		all, err := records(ctx)
		if err != nil {
			return instance.CheckDanger, err.Error()
		}
		return jobsState(all, time.Now())
	}}
}

// jobsState looks over the scheduled jobs: the worst finding wins, and a
// job that has not run yet is on schedule (the process just started). A
// job that is off is counted apart.
func jobsState(records []diag.JobRecord, now time.Time) (instance.CheckState, string) {
	state, detail := instance.CheckOK, ""
	worse := func(found instance.CheckState, words string) {
		if found > state {
			state, detail = found, words
		}
	}
	onSchedule, off := 0, 0
	var lastRan time.Time
	for _, record := range records {
		if jobOff(record) {
			off++
			continue
		}
		onSchedule++
		if record.LastStarted.After(lastRan) {
			lastRan = record.LastStarted
		}
		if record.Outcome == diag.Failed {
			worse(instance.CheckWarn, record.Name+" failed: "+record.LastError)
		}
		if record.NextDue.IsZero() || record.Interval <= 0 {
			continue
		}
		overdue := now.Sub(record.NextDue)
		switch {
		case overdue > overdueDanger*record.Interval:
			worse(instance.CheckDanger, fmt.Sprintf("%s overdue by %s", record.Name, sinceWords(overdue)))
		case overdue > overdueWarn*record.Interval:
			worse(instance.CheckWarn, fmt.Sprintf("%s overdue by %s", record.Name, sinceWords(overdue)))
		}
	}
	if state != instance.CheckOK {
		return state, detail
	}
	detail = fmt.Sprintf("%d jobs on schedule", onSchedule)
	if off > 0 {
		detail += fmt.Sprintf(" · %d off", off)
	}
	if lastRan.IsZero() {
		return instance.CheckOK, detail + " · none run yet"
	}
	return instance.CheckOK, detail + " · last ran " + sinceWords(now.Sub(lastRan)) + " ago"
}

// jobOff is a job whose schedule is disabled: no interval, whatever its
// history.
func jobOff(record diag.JobRecord) bool {
	return record.Interval <= 0
}

// ---- jobs runner ----

// newJobsRunnerCheck reads the heartbeat rows.
func newJobsRunnerCheck(dispatchers func(ctx context.Context) ([]jobs.Dispatcher, error)) instance.HealthCheck {
	return instance.HealthCheck{Name: "jobs runner", Run: func(ctx context.Context) (instance.CheckState, string) {
		all, err := dispatchers(ctx)
		if err != nil {
			return instance.CheckDanger, err.Error()
		}
		return jobsRunnerState(all, time.Now())
	}}
}

// jobsRunnerState goes by the newest heartbeat: warn when it is a minute
// old, danger at workerStale or when no dispatcher has registered.
func jobsRunnerState(dispatchers []jobs.Dispatcher, now time.Time) (instance.CheckState, string) {
	if len(dispatchers) == 0 {
		return instance.CheckDanger, "no dispatcher has registered"
	}
	var newest time.Time
	running := 0
	for _, dispatcher := range dispatchers {
		if dispatcher.SeenAt.After(newest) {
			newest = dispatcher.SeenAt
		}
		if now.Sub(dispatcher.SeenAt) < runnerQuiet {
			running++
		}
	}
	// A runner's clock may run ahead of this one; never read as the future.
	since := max(now.Sub(newest), 0)
	switch {
	case since >= workerStale:
		return instance.CheckDanger, "no dispatcher seen for " + sinceWords(since)
	case since >= runnerQuiet:
		return instance.CheckWarn, "no dispatcher seen for " + sinceWords(since)
	}
	return instance.CheckOK, fmt.Sprintf("%d running · seen %s ago", running, sinceWords(since))
}

// sinceWords is a duration the way the row says it: "3 min", "2 h", "1 d".
func sinceWords(span time.Duration) string {
	switch {
	case span < time.Minute:
		return fmt.Sprintf("%d s", int(span.Seconds()))
	case span < time.Hour:
		return fmt.Sprintf("%d min", int(span.Minutes()))
	case span < 24*time.Hour:
		return fmt.Sprintf("%d h", int(span.Hours()))
	}
	return fmt.Sprintf("%d d", int(span.Hours()/24))
}

func plural(count int64, one, many string) string {
	if count == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", count, many)
}
