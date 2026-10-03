package jobs

import (
	"cmp"
	"context"
	"slices"
	"sync"
	"time"

	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/rowid"
)

// RunDispatcher leases due rows and hands them to the worker pool, inserts
// jobs for due schedules and heartbeats job_dispatchers, until ctx ends.
// It then stops leasing, gives in-flight jobs ShutdownGrace to finish and
// clears the lease on any still running, so they are retried on the next
// start. It returns only after that, so the caller may close the pool.
func (s *Service) RunDispatcher(ctx context.Context) {
	dispatcherID := rowid.New()
	if err := s.queries.InsertDispatcher(ctx, dbgen.InsertDispatcherParams{
		ID: dispatcherID, Host: s.cfg.Host, Workers: int32(s.cfg.Workers), Now: s.now(),
	}); err != nil {
		s.log.Error("jobs: register dispatcher", "err", err)
	}

	workCtx, cancelWork := context.WithCancel(context.Background())
	defer cancelWork()
	tracked := newInflight()
	queue := make(chan dbgen.Job, s.cfg.Workers)
	var workers sync.WaitGroup
	for range s.cfg.Workers {
		workers.Go(func() { s.work(workCtx, queue, tracked) })
	}

	ticker := time.NewTicker(s.cfg.Poll)
	defer ticker.Stop()
	for ctx.Err() == nil {
		s.tick(ctx, dispatcherID, queue, tracked)
		select {
		case <-ctx.Done():
		case <-ticker.C:
		}
	}
	close(queue)
	s.shutdown(dispatcherID, &workers, cancelWork, tracked)
}

// tick is one poll: heartbeat, materialise due schedules, then lease
// until a batch comes back short.
func (s *Service) tick(ctx context.Context, dispatcherID string, queue chan<- dbgen.Job, tracked *inflight) {
	if err := s.queries.TouchDispatcher(ctx, dbgen.TouchDispatcherParams{Now: s.now(), ID: dispatcherID}); err != nil {
		s.logUnlessStopping(ctx, "jobs: heartbeat", err)
	}
	if err := s.materialiseDue(ctx); err != nil {
		s.logUnlessStopping(ctx, "jobs: schedules", err)
	}
	for s.leaseBatch(ctx, queue, tracked) {
	}
}

// leaseBatch claims up to the free-worker count and reports whether the
// batch was full, in which case more may be due.
func (s *Service) leaseBatch(ctx context.Context, queue chan<- dbgen.Job, tracked *inflight) bool {
	free := s.cfg.Workers - tracked.count()
	if free <= 0 || ctx.Err() != nil {
		return false
	}
	now := s.now()
	rows, err := s.queries.LeaseJobs(ctx, dbgen.LeaseJobsParams{
		Until: now.Add(s.lease), Now: now, Kinds: s.registry.Kinds(), Limit: int32(free),
	})
	if err != nil {
		s.logUnlessStopping(ctx, "jobs: lease", err)
		return false
	}
	slices.SortFunc(rows, func(left, right dbgen.Job) int {
		if byDue := left.NotBefore.Compare(right.NotBefore); byDue != 0 {
			return byDue
		}
		return cmp.Compare(left.CreatedAt.UnixNano(), right.CreatedAt.UnixNano())
	})
	for _, row := range rows {
		tracked.add(row.ID, row.Attempt)
		queue <- row
	}
	return len(rows) == free
}

// shutdown waits for the workers up to ShutdownGrace, cancels what is
// still running, releases those rows, removes the heartbeat and gives the
// cancelled workers outcomeTimeout to leave before the caller closes the
// pool.
func (s *Service) shutdown(dispatcherID string, workers *sync.WaitGroup, cancelWork context.CancelFunc, tracked *inflight) {
	done := make(chan struct{})
	go func() {
		workers.Wait()
		close(done)
	}()
	if !waitUntil(done, s.cfg.ShutdownGrace) {
		cancelWork()
	}
	ctx, cancel := context.WithTimeout(context.Background(), outcomeTimeout)
	defer cancel()
	if ids, attempts := tracked.drain(); len(ids) > 0 {
		if err := s.queries.ReleaseJobs(ctx, dbgen.ReleaseJobsParams{Ids: ids, Attempts: attempts}); err != nil {
			s.log.Error("jobs: release in-flight rows", "count", len(ids), "err", err)
		}
	}
	if err := s.queries.DeleteDispatcher(ctx, dispatcherID); err != nil {
		s.log.Error("jobs: remove dispatcher", "err", err)
	}
	if !waitUntil(done, outcomeTimeout) {
		s.log.Warn("jobs: workers still running at shutdown", "count", s.cfg.Workers)
	}
}

// waitUntil reports whether done closed before the timeout.
func waitUntil(done <-chan struct{}, timeout time.Duration) bool {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-done:
		return true
	case <-timer.C:
		return false
	}
}

func (s *Service) logUnlessStopping(ctx context.Context, msg string, err error) {
	if ctx.Err() == nil {
		s.log.Error(msg, "err", err)
	}
}
