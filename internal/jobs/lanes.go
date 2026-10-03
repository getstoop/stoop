package jobs

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/getstoop/stoop/internal/dbgen"
)

// Lanes serialise jobs: with a lane set, one job per lane runs at a time,
// in sequence order, and a job whose turn has not come (a retry waiting
// on its backoff) holds the lane. The webhook rule; sweeps have no lane.
// See docs/architecture/runtime.md → Background work.

var errEmptyLane = errors.New("enqueue in lane: lane is empty")

// EnqueueInLane queues kind for now in lane at sequence and returns the
// job's id. lane must be set; sequence orders the lane.
func (s *Service) EnqueueInLane(ctx context.Context, kind string, args any, lane string, sequence int64) (string, error) {
	if lane == "" {
		return "", errEmptyLane
	}
	return s.insertJob(ctx, kind, args, s.now(), &lane, &sequence)
}

// DiscardLane discards the lane's queued jobs with reason as their error
// and reports how many; a job already running finishes on its own. For
// a caller whose lane's owner (a webhook) is being deleted.
func (s *Service) DiscardLane(ctx context.Context, lane, reason string) (int64, error) {
	discarded, err := s.queries.DiscardLane(ctx, dbgen.DiscardLaneParams{Now: s.now(), Error: reason, Lane: lane})
	if err != nil {
		return 0, fmt.Errorf("discard lane %q: %w", lane, err)
	}
	return discarded, nil
}

// Backlog is a kind's unfinished rows as the Diagnostics tab reads them.
type Backlog struct {
	// Queued is rows waiting to run: queued, or running with a lapsed lease.
	Queued int64
	// Running is rows whose lease is live.
	Running int64
	// OldestDue is the not_before of the earliest queued row that is due;
	// zero when none is. The dispatcher is stalled when this grows old.
	OldestDue time.Time
}

// Backlog counts kind's unfinished rows in one query.
func (s *Service) Backlog(ctx context.Context, kind string) (Backlog, error) {
	row, err := s.queries.KindBacklog(ctx, dbgen.KindBacklogParams{Now: s.now(), Kind: kind})
	if err != nil {
		return Backlog{}, fmt.Errorf("backlog of %q: %w", kind, err)
	}
	return Backlog{Queued: row.Queued, Running: row.Running, OldestDue: row.OldestDue}, nil
}
