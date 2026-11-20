package push

import (
	"context"
	"fmt"
	"time"
)

// What the Diagnostics tab's push row reads: how many devices are
// registered, how many failed their last delivery, and why, from the
// rows themselves, so it holds wherever the jobs ran. No endpoint, key or
// token is ever part of it.

// maxReasons is how many reasons the row lists.
const maxReasons = 3

// DeliveryStats is the row's numbers.
type DeliveryStats struct {
	Devices int
	// Failing is the devices whose last delivery failed.
	Failing int
	// Reasons is why, the most recent first, at most maxReasons.
	Reasons []FailureReason
}

// FailureReason is one reason and the devices it holds.
type FailureReason struct {
	Reason  string
	Devices int
	Latest  time.Time
}

func (s *Service) DeliveryStats(ctx context.Context) (DeliveryStats, error) {
	counts, err := s.q.PushDeliveryStats(ctx)
	if err != nil {
		return DeliveryStats{}, fmt.Errorf("count push subscriptions: %w", err)
	}
	stats := DeliveryStats{Devices: int(counts.Devices), Failing: int(counts.Failing)}
	if stats.Failing == 0 {
		return stats, nil
	}
	rows, err := s.q.PushFailureReasons(ctx, maxReasons)
	if err != nil {
		return DeliveryStats{}, fmt.Errorf("list push failures: %w", err)
	}
	for _, row := range rows {
		stats.Reasons = append(stats.Reasons, FailureReason{Reason: row.Reason, Devices: int(row.Devices), Latest: row.Latest})
	}
	return stats, nil
}
