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

// releaseTimeout bounds the writes that give in-flight rows back and
// remove the heartbeat at shutdown; leaveTimeout is how long the
// cancelled workers get to return after that.
const (
	releaseTimeout = 3 * time.Second
	leaveTimeout   = time.Second
)

// RunDispatcher leases due rows and hands them to the worker pool, inserts
// jobs for due schedules and heartbeats job_dispatchers, until ctx ends.
// It runs a pass when an insert notifies NotifyChannel and every Poll as
// the backstop. It then stops leasing, gives in-flight jobs ShutdownGrace
// (five seconds by default) to finish, three seconds to release any still
// running so they are retried on the next start, and one second for the
// cancelled workers to leave: under ten seconds in all, whatever a
// performer does. It returns only after that, so the caller may close the
// pool.
func (s *Service) RunDispatcher(ctx context.Context) {
	wake := make(chan struct{}, 1)
	listenerDone := make(chan struct{})
	go func() {
		defer close(listenerDone)
		s.listen(ctx, wake)
	}()
	registration := dbgen.UpsertDispatcherParams{
		ID: rowid.New(), Host: s.cfg.Host, Workers: int32Column(s.cfg.Workers), StartedAt: s.now(),
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
	heartbeat := time.NewTicker(s.heartbeat)
	defer heartbeat.Stop()
	for ctx.Err() == nil {
		s.tick(ctx, registration, queue, tracked)
		select {
		case <-ctx.Done():
		case <-ticker.C:
		case <-wake:
		case <-heartbeat.C:
			// Between passes the row is kept fresh on its own clock, so a
			// long poll never reads as a dead runner.
			s.touch(ctx, registration)
		}
	}
	close(queue)
	s.shutdown(registration.ID, &workers, cancelWork, tracked)
	// The listener closes its connection meanwhile; the caller closes the
	// pool only once it has.
	<-listenerDone
}

// tick is one poll: heartbeat, materialise due schedules, then lease
// until a batch comes back short.
func (s *Service) tick(ctx context.Context, registration dbgen.UpsertDispatcherParams, queue chan<- dbgen.Job, tracked *inflight) {
	s.touch(ctx, registration)
	if err := s.materialiseDue(ctx); err != nil {
		s.logUnlessStopping(ctx, "jobs: schedules", err)
	}
	for s.leaseBatch(ctx, queue, tracked) {
	}
}

// touch is the heartbeat: an upsert of this dispatcher's row with seen_at
// = now, so a row that was never written or has gone comes back.
func (s *Service) touch(ctx context.Context, registration dbgen.UpsertDispatcherParams) {
	registration.Now = s.now()
	if err := s.queries.UpsertDispatcher(ctx, registration); err != nil {
		s.logUnlessStopping(ctx, "jobs: heartbeat", err)
	}
}

// leaseBatch claims up to the free-worker count and reports whether the
// batch was full, in which case more may be due.
func (s *Service) leaseBatch(ctx context.Context, queue chan<- dbgen.Job, tracked *inflight) bool {
	free := s.cfg.Workers - tracked.count()
	if free <= 0 || ctx.Err() != nil {
		return false
	}
	rows := s.leaseDue(ctx, free, tracked.ids())
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

// leaseDue leases the capped kinds first, each under its lock, then the
// uncapped kinds in one query for the slots left. Capped first because
// their caps bound what they take, while a stream of uncapped work could
// otherwise fill every slot ahead of them. A failed lease ends the pass;
// what was leased before it is still returned.
func (s *Service) leaseDue(ctx context.Context, free int, excluded []string) []dbgen.Job {
	now := s.now()
	var rows []dbgen.Job
	for _, kind := range s.registry.cappedKinds() {
		remaining := free - len(rows)
		if remaining <= 0 {
			return rows
		}
		capped, err := s.leaseCapped(ctx, now, kind, remaining, excluded)
		if err != nil {
			s.logUnlessStopping(ctx, "jobs: lease "+kind.kind, err)
			return rows
		}
		rows = append(rows, capped...)
	}
	if remaining := free - len(rows); remaining > 0 {
		uncapped, err := s.queries.LeaseJobs(ctx, dbgen.LeaseJobsParams{
			Until: now.Add(s.lease), Now: now, Kinds: s.registry.uncappedKinds(), Excluded: excluded, Limit: int32Column(remaining),
		})
		if err != nil {
			s.logUnlessStopping(ctx, "jobs: lease", err)
			return rows
		}
		rows = append(rows, uncapped...)
	}
	return rows
}

// shutdown waits for the workers up to ShutdownGrace, takes over the rows
// still in flight before cancelling what runs them (so a performer that
// returns on the cancel writes no outcome), releases those rows and
// removes the heartbeat within releaseTimeout, and gives the cancelled
// workers leaveTimeout to return before the caller closes the pool.
func (s *Service) shutdown(dispatcherID string, workers *sync.WaitGroup, cancelWork context.CancelFunc, tracked *inflight) {
	done := make(chan struct{})
	go func() {
		workers.Wait()
		close(done)
	}()
	var ids []string
	var attempts []int32
	if !waitUntil(done, s.cfg.ShutdownGrace) {
		ids, attempts = tracked.drain()
		cancelWork()
	}
	ctx, cancel := context.WithTimeout(context.Background(), releaseTimeout)
	defer cancel()
	if len(ids) > 0 {
		if err := s.queries.ReleaseJobs(ctx, dbgen.ReleaseJobsParams{Ids: ids, Attempts: attempts}); err != nil {
			s.log.Error("jobs: release in-flight rows", "count", len(ids), "err", err)
		}
	}
	if err := s.queries.DeleteDispatcher(ctx, dispatcherID); err != nil {
		s.log.Error("jobs: remove dispatcher", "err", err)
	}
	if !waitUntil(done, leaveTimeout) {
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
