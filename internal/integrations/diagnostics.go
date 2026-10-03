package integrations

import (
	"context"
	"fmt"
	"time"
)

// DeliveryStats is the delivery log as the Diagnostics tab reads it:
// finished deliveries that were never delivered, and how many outgoing
// hooks exist at all. Queued and in-flight counts are the jobs module's.
type DeliveryStats struct {
	Dead, DeadLastHour int64
	Hooks              int64
}

// DeliveryStats counts the log in one query.
func (s *Service) DeliveryStats(ctx context.Context) (DeliveryStats, error) {
	row, err := s.q.DeliveryStats(ctx, s.now().Add(-time.Hour))
	if err != nil {
		return DeliveryStats{}, fmt.Errorf("delivery stats: %w", err)
	}
	return DeliveryStats{Dead: row.Dead, DeadLastHour: row.DeadLastHour, Hooks: row.Hooks}, nil
}
