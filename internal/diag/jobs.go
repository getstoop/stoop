package diag

import (
	"sort"
	"sync"
	"time"
)

// Counters is what one job pass reports: files_removed, bytes_freed …
type Counters map[string]int64

type Outcome int

const (
	NeverRan Outcome = iota
	Succeeded
	Failed
	Running
)

// JobRecord is one row of the Background work panel.
type JobRecord struct {
	Name         string
	Interval     time.Duration
	Continuous   bool
	LastStarted  time.Time
	LastSuccess  time.Time
	LastDuration time.Duration
	Outcome      Outcome
	LastError    string
	Counters     Counters
	NextDue      time.Time
}

// Job records the passes of one background loop.
type Job struct {
	name string

	mu           sync.Mutex
	interval     time.Duration
	continuous   bool
	lastStarted  time.Time
	lastSuccess  time.Time
	lastDuration time.Duration
	outcome      Outcome
	lastError    string
	counters     Counters
}

// Job returns the job registered under name, creating it on first use.
func (r *Registry) Job(name string) *Job {
	r.mu.Lock()
	defer r.mu.Unlock()
	if j, ok := r.jobs[name]; ok {
		return j
	}
	j := &Job{name: name}
	r.jobs[name] = j
	return j
}

// Every declares how often the loop runs; NextDue is the last start plus d.
func (j *Job) Every(d time.Duration) *Job {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.interval = d
	j.continuous = false
	return j
}

// Continuous marks a worker that never stops, so it is never due.
func (j *Job) Continuous() *Job {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.interval = 0
	j.continuous = true
	return j
}

// Run records one pass: Running while fn is inside, then its duration,
// outcome, error and counters.
func (j *Job) Run(fn func() (Counters, error)) {
	start := time.Now()
	j.mu.Lock()
	j.lastStarted = start
	j.outcome = Running
	j.lastError = ""
	j.counters = nil
	j.mu.Unlock()

	counters, err := fn()

	j.mu.Lock()
	defer j.mu.Unlock()
	j.lastDuration = time.Since(start)
	j.counters = counters
	if err != nil {
		j.outcome = Failed
		j.lastError = err.Error()
		return
	}
	j.outcome = Succeeded
	j.lastSuccess = start
}

func (j *Job) Record() JobRecord {
	j.mu.Lock()
	defer j.mu.Unlock()
	rec := JobRecord{
		Name:         j.name,
		Interval:     j.interval,
		Continuous:   j.continuous,
		LastStarted:  j.lastStarted,
		LastSuccess:  j.lastSuccess,
		LastDuration: j.lastDuration,
		Outcome:      j.outcome,
		LastError:    j.lastError,
		Counters:     make(Counters, len(j.counters)),
	}
	for k, v := range j.counters {
		rec.Counters[k] = v
	}
	if !j.continuous && j.interval > 0 && !j.lastStarted.IsZero() {
		rec.NextDue = j.lastStarted.Add(j.interval)
	}
	return rec
}

// Jobs lists every job, sorted by name.
func (r *Registry) Jobs() []JobRecord {
	r.mu.Lock()
	jobs := make([]*Job, 0, len(r.jobs))
	for _, j := range r.jobs {
		jobs = append(jobs, j)
	}
	r.mu.Unlock()
	out := make([]JobRecord, 0, len(jobs))
	for _, j := range jobs {
		out = append(out, j.Record())
	}
	sort.Slice(out, func(i, k int) bool { return out[i].Name < out[k].Name })
	return out
}
