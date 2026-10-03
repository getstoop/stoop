package app

import (
	"context"
	"fmt"
	"time"

	"github.com/getstoop/stoop/internal/diag"
	"github.com/getstoop/stoop/internal/instance"
)

// The Health panel's last two rows, from the job list and the queue
// port. Thresholds are the table in docs/architecture/diagnostics.md.

const (
	workerStale   = 5 * time.Minute
	overdueWarn   = 1
	overdueDanger = 3
)

// ---- webhooks ----

// newWebhooksCheck reads the delivery backlog and log through the shared
// cache.
func newWebhooksCheck(q *queueStats) instance.HealthCheck {
	return instance.HealthCheck{Name: "webhooks", FixTab: "integrations", Run: func(ctx context.Context) (instance.CheckState, string) {
		stats, err := q.stats(ctx)
		if err != nil {
			return instance.CheckDanger, err.Error()
		}
		return webhooksState(stats, time.Now())
	}}
}

// webhooksState is danger when a due delivery has waited workerStale: the
// dispatcher is not taking them.
func webhooksState(q instance.QueueStats, now time.Time) (instance.CheckState, string) {
	if q.Hooks == 0 {
		return instance.CheckOff, "no outgoing webhooks"
	}
	if waited := now.Sub(q.OldestDue); q.Queued > 0 && !q.OldestDue.IsZero() && waited >= workerStale {
		return instance.CheckDanger, fmt.Sprintf("%d queued and the oldest has waited %s", q.Queued, sinceWords(waited))
	}
	if q.DeadLastHour > 0 {
		return instance.CheckWarn, fmt.Sprintf("%s dead-lettered in the last hour", plural(q.DeadLastHour, "delivery", "deliveries"))
	}
	return instance.CheckOK, fmt.Sprintf("%d queued · none dead-lettered in the last hour", q.Queued)
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
func jobsState(jobs []diag.JobRecord, now time.Time) (instance.CheckState, string) {
	state, detail := instance.CheckOK, ""
	worse := func(st instance.CheckState, d string) {
		if st > state {
			state, detail = st, d
		}
	}
	n, off := 0, 0
	var lastRan time.Time
	for _, j := range jobs {
		if j.Continuous {
			continue
		}
		if jobOff(j) {
			off++
			continue
		}
		n++
		if j.LastStarted.After(lastRan) {
			lastRan = j.LastStarted
		}
		if j.Outcome == diag.Failed {
			worse(instance.CheckWarn, j.Name+" failed: "+j.LastError)
		}
		if j.NextDue.IsZero() || j.Interval <= 0 {
			continue
		}
		overdue := now.Sub(j.NextDue)
		switch {
		case overdue > overdueDanger*j.Interval:
			worse(instance.CheckDanger, fmt.Sprintf("%s overdue by %s", j.Name, sinceWords(overdue)))
		case overdue > overdueWarn*j.Interval:
			worse(instance.CheckWarn, fmt.Sprintf("%s overdue by %s", j.Name, sinceWords(overdue)))
		}
	}
	if state != instance.CheckOK {
		return state, detail
	}
	detail = fmt.Sprintf("%d jobs on schedule", n)
	if off > 0 {
		detail += fmt.Sprintf(" · %d off", off)
	}
	if lastRan.IsZero() {
		return instance.CheckOK, detail + " · none run yet"
	}
	return instance.CheckOK, detail + " · last ran " + sinceWords(now.Sub(lastRan)) + " ago"
}

// jobOff is a scheduled job whose schedule is disabled: no interval,
// whatever its history.
func jobOff(j diag.JobRecord) bool {
	return !j.Continuous && j.Interval <= 0
}

// sinceWords is a duration the way the row says it: "3 min", "2 h", "1 d".
func sinceWords(d time.Duration) string {
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%d s", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%d min", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%d h", int(d.Hours()))
	}
	return fmt.Sprintf("%d d", int(d.Hours()/24))
}

func plural(n int64, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}
