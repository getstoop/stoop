package chat

import (
	"context"
	"fmt"

	"github.com/getstoop/stoop/internal/dbgen"
)

// alertCounts is one person's Channel.alert_count by channel id and
// Space.alert_count by space id, from one CountAlerts query. A channel or
// space with nothing to show has no entry, so a lookup reads 0.
type alertCounts struct {
	byChannel map[string]int32
	bySpace   map[string]int32
}

// countAlerts is the caller's alert counts for one space, or for every
// space they are in when spaceID is nil. The rules live in CountAlerts
// (docs/architecture/messaging.md → Alert counts); this only adds them up.
func (s *Service) countAlerts(ctx context.Context, userID string, spaceID *string) (alertCounts, error) {
	rows, err := s.q.CountAlerts(ctx, dbgen.CountAlertsParams{UserID: userID, SpaceID: spaceID})
	if err != nil {
		return alertCounts{}, fmt.Errorf("count alerts: %w", err)
	}
	counts := alertCounts{
		byChannel: make(map[string]int32, len(rows)),
		bySpace:   map[string]int32{},
	}
	for _, row := range rows {
		counts.byChannel[row.ChannelID] = row.AlertCount
		if row.SpaceID != nil {
			counts.bySpace[*row.SpaceID] += row.AlertCount
		}
	}
	return counts, nil
}
