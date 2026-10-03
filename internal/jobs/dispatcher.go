package jobs

import "context"

// RunDispatcher leases due rows and hands them to the worker pool, inserts
// jobs for due schedules and heartbeats job_dispatchers, until ctx ends.
// It then stops leasing, gives in-flight jobs ShutdownGrace to finish and
// clears the lease on any still running, so they are retried on the next
// start. It returns only after that, so the caller may close the pool.
func (s *Service) RunDispatcher(ctx context.Context) { panic("jobs: not built") }
