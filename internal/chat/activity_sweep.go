package chat

import (
	"context"
	"log/slog"
	"time"
)

// Activity retention: read items older than the window go, unread ones
// never. See docs/architecture/messaging.md → Activity → Retention.

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
