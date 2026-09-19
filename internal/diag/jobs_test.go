package diag

import (
	"errors"
	"testing"
	"time"
)

func TestJobRun(t *testing.T) {
	r := NewRegistry()
	j := r.Job("file_sweep").Every(time.Hour)
	if r.Job("file_sweep") != j {
		t.Fatal("Job should be idempotent by name")
	}
	if rec := j.Record(); rec.Outcome != NeverRan || !rec.NextDue.IsZero() {
		t.Errorf("before any run: %+v", rec)
	}
	j.Run(func() (Counters, error) {
		if got := j.Record().Outcome; got != Running {
			t.Errorf("inside Run: outcome %v, want Running", got)
		}
		return Counters{"files_removed": 3}, nil
	})
	rec := j.Record()
	if rec.Outcome != Succeeded || rec.LastError != "" || rec.Counters["files_removed"] != 3 {
		t.Errorf("after success: %+v", rec)
	}
	if rec.LastStarted.IsZero() || rec.NextDue != rec.LastStarted.Add(time.Hour) || rec.LastSuccess != rec.LastStarted {
		t.Errorf("timestamps: %+v", rec)
	}
	if rec.Interval != time.Hour || rec.Continuous {
		t.Errorf("interval: %+v", rec)
	}

	j.Run(func() (Counters, error) { return nil, errors.New("disk full") })
	failed := j.Record()
	if failed.Outcome != Failed || failed.LastError != "disk full" || len(failed.Counters) != 0 {
		t.Errorf("after failure: %+v", failed)
	}
	if failed.LastSuccess != rec.LastSuccess {
		t.Error("a failed run must keep the previous LastSuccess")
	}
}

func TestJobContinuous(t *testing.T) {
	j := NewRegistry().Job("webhook_worker").Continuous()
	j.Run(func() (Counters, error) { return nil, nil })
	rec := j.Record()
	if !rec.Continuous || rec.Interval != 0 || !rec.NextDue.IsZero() {
		t.Errorf("continuous job: %+v", rec)
	}
}

func TestRegistryJobsSorted(t *testing.T) {
	r := NewRegistry()
	r.Job("zeta")
	r.Job("alpha")
	jobs := r.Jobs()
	if len(jobs) != 2 || jobs[0].Name != "alpha" || jobs[1].Name != "zeta" {
		t.Errorf("Jobs = %+v", jobs)
	}
}
