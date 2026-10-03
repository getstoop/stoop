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

// SweepActivityKind is the job kind internal/app registers for SweepActivity.
const SweepActivityKind = "sweep_activity"
