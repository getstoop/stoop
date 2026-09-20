package integrations

import (
	"context"
	"fmt"
	"time"

	"github.com/getstoop/stoop/internal/dbgen"
)

// QueueStats is the queue as the Diagnostics tab reads it: unfinished
// items waiting or leased, finished ones that were never delivered, and
// how many outgoing hooks exist at all.
type QueueStats struct {
	Queued, Leased, Dead, DeadLastHour int64
	Hooks                              int64
}

// QueueStats counts webhook_deliveries by state in one query.
func (s *Service) QueueStats(ctx context.Context) (QueueStats, error) {
	now := s.now()
	row, err := s.q.QueueStats(ctx, dbgen.QueueStatsParams{Now: now, Since: now.Add(-time.Hour)})
	if err != nil {
		return QueueStats{}, fmt.Errorf("queue stats: %w", err)
	}
	return QueueStats{
		Queued: row.Queued, Leased: row.Leased, Dead: row.Dead,
		DeadLastHour: row.DeadLastHour, Hooks: row.Hooks,
	}, nil
}
