package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/getstoop/stoop/internal/dbgen"
)

// outcomeTimeout bounds the write that records how an attempt ended.
const outcomeTimeout = 10 * time.Second

// work runs leased rows from queue until it closes, one at a time.
func (s *Service) work(ctx context.Context, queue <-chan dbgen.Job, tracked *inflight) {
	for row := range queue {
		s.perform(ctx, row, tracked)
	}
}

func (s *Service) perform(ctx context.Context, row dbgen.Job, tracked *inflight) {
	job := &Job{
		ID: row.ID, Kind: row.Kind, Attempt: int(row.Attempt), args: row.Args, now: s.now,
		extend: func(ctx context.Context, until time.Time) error {
			return s.queries.ExtendJobLease(ctx, dbgen.ExtendJobLeaseParams{Until: until, ID: row.ID})
		},
	}
	entry, ok := s.registry.lookup(row.Kind)
	if !ok {
		tracked.remove(row.ID)
		return
	}
	err := performSafely(ctx, entry.performer, job)
	if !tracked.remove(row.ID) {
		return
	}
	writeCtx, cancel := context.WithTimeout(context.Background(), outcomeTimeout)
	defer cancel()
	if writeErr := s.writeOutcome(writeCtx, row, job, entry.opts, err); writeErr != nil {
		s.log.Error("job outcome not recorded", "kind", row.Kind, "id", row.ID, "err", writeErr)
	}
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
	if err == nil {
		return s.queries.FinishJob(ctx, dbgen.FinishJobParams{
			State: string(StateSucceeded), Now: now, Error: "", Counters: counters, ID: row.ID,
		})
	}
	s.log.Warn("job attempt failed", "kind", row.Kind, "id", row.ID, "attempt", row.Attempt, "err", err)
	if isDiscard(err) || int(row.Attempt) >= int(row.MaxAttempts) {
		return s.queries.FinishJob(ctx, dbgen.FinishJobParams{
			State: string(StateDiscarded), Now: now, Error: err.Error(), Counters: counters, ID: row.ID,
		})
	}
	wait := retryWait(err, int(row.Attempt), opts.Backoff)
	return s.queries.RequeueJob(ctx, dbgen.RequeueJobParams{
		Now: now, Error: err.Error(), Counters: counters, NotBefore: now.Add(wait), ID: row.ID,
	})
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
