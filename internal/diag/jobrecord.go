package diag

import "time"

// JobRecord is the row shape of the Background work panel and the job
// families on /metrics; internal/app fills it from the jobs tables.

// Counters is what one job pass reports: files_removed, bytes_freed …
type Counters map[string]int64

type Outcome int

const (
	NeverRan Outcome = iota
	Succeeded
	Failed
	Running
)

type JobRecord struct {
	Name         string
	Interval     time.Duration
	LastStarted  time.Time
	LastSuccess  time.Time
	LastDuration time.Duration
	Outcome      Outcome
	LastError    string
	Counters     Counters
	NextDue      time.Time
}
