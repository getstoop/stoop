package jobs

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

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
	return s.insertJob(ctx, s.queries, kind, args, s.now(), &lane, &sequence)
}

// EnqueueInLaneTx is EnqueueInLane inside the caller's transaction: the
// job exists only if the caller commits, and the dispatcher hears of it
// at the commit.
func (s *Service) EnqueueInLaneTx(ctx context.Context, tx pgx.Tx, kind string, args any, lane string, sequence int64) (string, error) {
	if lane == "" {
		return "", errEmptyLane
	}
	return s.insertJob(ctx, s.queries.WithTx(tx), kind, args, s.now(), &lane, &sequence)
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
