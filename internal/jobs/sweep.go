package jobs

import (
	"context"
	"fmt"
	"time"
)

// SweepJobsKind removes finished rows older than Config.Retention and
// dispatcher rows not seen for an hour. The module registers it;
// internal/app schedules it like the other kinds.
const SweepJobsKind = "sweep_jobs"

const SweepJobsInterval = time.Hour

// dispatcherStale is how long a heartbeat may go unseen before its row
// is swept.
const dispatcherStale = time.Hour

func (s *Service) sweepJobs(ctx context.Context, job *Job, _ NoArgs) error {
	now := s.now()
	var jobsRemoved int64
	if s.cfg.Retention > 0 {
		removed, err := s.queries.SweepFinishedJobs(ctx, now.Add(-s.cfg.Retention))
		if err != nil {
			return fmt.Errorf("sweep finished jobs: %w", err)
		}
		jobsRemoved = removed
	}
	dispatchersRemoved, err := s.queries.SweepDispatchers(ctx, now.Add(-dispatcherStale))
	if err != nil {
		return fmt.Errorf("sweep dispatchers: %w", err)
	}
	job.Record(Counters{"jobs_removed": jobsRemoved, "dispatchers_removed": dispatchersRemoved})
	return nil
}
