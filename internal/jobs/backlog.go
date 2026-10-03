package jobs

import (
	"context"
	"fmt"
	"time"

	"github.com/getstoop/stoop/internal/dbgen"
)

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
