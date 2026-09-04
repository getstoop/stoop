package chat

import (
	"context"
	"log/slog"
	"time"
)

// Activity retention. Mention, reply and DM items are rows that nobody
// deletes: once read they are history the activity page can still show,
// but not forever. The sweep removes read items older than the retention
// window; unread ones stay however old, so nothing someone hasn't seen is
// taken from them.

const (
	// DefaultActivityRetention keeps a month of read items.
	DefaultActivityRetention = 30 * 24 * time.Hour
	activitySweepDelay       = 2 * time.Minute
)

// SweepActivity removes read activity items whose read_at is older than
// retention and reports how many went. retention <= 0 removes none.
func (s *Service) SweepActivity(ctx context.Context, retention time.Duration) (int64, error) {
	if retention <= 0 {
		return 0, nil
	}
	n, err := s.q.DeleteReadActivityBefore(ctx, time.Now().Add(-retention))
	if err != nil {
		return 0, err
	}
	if n > 0 {
		slog.Default().Info("activity swept", "removed", n, "older_than", retention.String())
	}
	return n, nil
}

// RunActivitySweeper sweeps on a timer until ctx ends: once shortly
// after start, then every interval. interval or retention <= 0 disables.
func (s *Service) RunActivitySweeper(ctx context.Context, interval, retention time.Duration) {
	if interval <= 0 || retention <= 0 {
		return
	}
	run := func() {
		if _, err := s.SweepActivity(ctx, retention); err != nil && ctx.Err() == nil {
			slog.Default().Warn("activity sweep failed", "err", err)
		}
	}
	select {
	case <-ctx.Done():
		return
	case <-time.After(activitySweepDelay):
		run()
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			run()
		}
	}
}
