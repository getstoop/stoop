package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/getstoop/stoop/internal/dbgen"
)

// outcomeTimeout bounds the write that records how an attempt ended.
const outcomeTimeout = 10 * time.Second

const lapsedLeaseError = "attempts exhausted: the lease lapsed"

// work runs leased rows from queue until it closes, one at a time.
func (s *Service) work(ctx context.Context, queue <-chan dbgen.Job, tracked *inflight) {
	for row := range queue {
		s.perform(ctx, row, tracked)
	}
}

func (s *Service) perform(ctx context.Context, row dbgen.Job, tracked *inflight) {
	entry, ok := s.registry.lookup(row.Kind)
	if !ok {
		tracked.remove(row.ID)
		return
	}
	job := s.newJob(row)
	var err error
	if row.Attempt > row.MaxAttempts {
		err = Discard(errors.New(lapsedLeaseError))
	} else {
		err = s.performRenewing(ctx, entry, job, row)
	}
	if !tracked.remove(row.ID) {
		return
	}
	writeCtx, cancel := context.WithTimeout(context.Background(), outcomeTimeout)
	defer cancel()
	if writeErr := s.writeOutcome(writeCtx, row, job, entry.opts, err); writeErr != nil {
		s.log.Error("job outcome not recorded", "kind", row.Kind, "id", row.ID, "err", writeErr)
	}
}

func (s *Service) newJob(row dbgen.Job) *Job {
	return &Job{
		ID: row.ID, Kind: row.Kind, Attempt: int(row.Attempt), args: row.Args, now: s.now,
		extend: func(ctx context.Context, until time.Time) error {
			return s.extendLease(ctx, row, until)
		},
	}
}

// performRenewing runs the performer while a goroutine renews the lease
// every half lease, so only a dead or hung performer loses its row.
func (s *Service) performRenewing(ctx context.Context, entry kindEntry, job *Job, row dbgen.Job) error {
	renewCtx, stopRenewing := context.WithCancel(ctx)
	renewed := make(chan struct{})
	go func() {
		defer close(renewed)
		s.renewLease(renewCtx, row)
	}()
	err := performSafely(ctx, entry.performer, job)
	stopRenewing()
	<-renewed
	return err
}

func (s *Service) renewLease(ctx context.Context, row dbgen.Job) {
	ticker := time.NewTicker(s.lease / 2)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		if err := s.extendLease(ctx, row, s.now().Add(s.lease)); err != nil && ctx.Err() == nil {
			s.log.Error("job lease not renewed", "kind", row.Kind, "id", row.ID, "err", err)
		}
	}
}

func (s *Service) extendLease(ctx context.Context, row dbgen.Job, until time.Time) error {
	changed, err := s.queries.ExtendJobLease(ctx, dbgen.ExtendJobLeaseParams{Until: until, ID: row.ID, Attempt: row.Attempt})
	if err != nil {
		return err
	}
	s.noteStale(changed, row)
	return nil
}

func performSafely(ctx context.Context, performer Performer, job *Job) (err error) {
	defer func() {
		if value := recover(); value != nil {
			err = fmt.Errorf("panic: %v", value)
		}
	}()
	return performer.Perform(ctx, job)
}

func (s *Service) writeOutcome(ctx context.Context, row dbgen.Job, job *Job, opts Options, err error) error {
	now := s.now()
	counters := encodeCounters(job.recorded())
	var changed int64
	var writeErr error
	switch {
	case err == nil:
		changed, writeErr = s.queries.FinishJob(ctx, dbgen.FinishJobParams{
			State: string(StateSucceeded), Now: now, Error: "", Counters: counters, ID: row.ID, Attempt: row.Attempt,
		})
	case isDiscard(err) || row.Attempt >= row.MaxAttempts:
		s.log.Warn("job attempt failed", "kind", row.Kind, "id", row.ID, "attempt", row.Attempt, "err", err)
		changed, writeErr = s.queries.FinishJob(ctx, dbgen.FinishJobParams{
			State: string(StateDiscarded), Now: now, Error: err.Error(), Counters: counters, ID: row.ID, Attempt: row.Attempt,
		})
	default:
		s.log.Warn("job attempt failed", "kind", row.Kind, "id", row.ID, "attempt", row.Attempt, "err", err)
		wait := retryWait(err, int(row.Attempt), opts.Backoff)
		changed, writeErr = s.queries.RequeueJob(ctx, dbgen.RequeueJobParams{
			Now: now, Error: err.Error(), Counters: counters, NotBefore: now.Add(wait), ID: row.ID, Attempt: row.Attempt,
		})
	}
	if writeErr != nil {
		return writeErr
	}
	s.noteStale(changed, row)
	return nil
}

// noteStale logs a guarded write that matched no row: the attempt it was
// leased for is no longer the row's.
func (s *Service) noteStale(changed int64, row dbgen.Job) {
	if changed == 0 {
		s.log.Warn("outcome from a stale attempt dropped", "kind", row.Kind, "id", row.ID, "attempt", row.Attempt)
	}
}

func encodeCounters(counters Counters) []byte {
	if len(counters) == 0 {
		return nil
	}
	encoded, err := json.Marshal(counters)
	if err != nil {
		return nil
	}
	return encoded
}
