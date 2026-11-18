package chat

import (
	"context"
	"fmt"

	"github.com/getstoop/stoop/internal/apierr"
)

// What the push module asks chat for, through its Chat port, to fill a
// notification: the names of where it happened and what waits for the
// person. Nothing here checks a permission; push only asks about an
// activity item chat already addressed to the recipient.

// PlaceNames is a channel's name and its space's, both empty for a
// direct message.
func (s *Service) PlaceNames(ctx context.Context, channelID string) (space, channel string, err error) {
	row, err := s.q.GetChannel(ctx, channelID)
	if err != nil {
		return "", "", apierr.NotFoundOr(err, "channel")
	}
	if isDM(row) {
		return "", "", nil
	}
	spaceRow, err := s.q.GetSpace(ctx, *row.SpaceID)
	if err != nil {
		return "", "", apierr.NotFoundOr(err, "space")
	}
	return spaceRow.Name, row.Name, nil
}

// WaitingTotal is what the apps put on the icon for this server: the
// alerts over every space (CountAlerts leaves muted places out), plus one
// per open, unmuted conversation with unread messages. It is web's
// core/alerts alertingTotal, counted on the server.
func (s *Service) WaitingTotal(ctx context.Context, userID string) (int, error) {
	alerts, err := s.countAlerts(ctx, userID, nil)
	if err != nil {
		return 0, err
	}
	total := 0
	for _, count := range alerts.bySpace {
		total += int(count)
	}
	dms, err := s.q.ListDMChannelsByUser(ctx, userID)
	if err != nil {
		return 0, fmt.Errorf("list dms: %w", err)
	}
	for _, dm := range dms {
		if !dm.Muted && dm.ClosedAt == nil && dm.UnreadCount > 0 {
			total++
		}
	}
	return total, nil
}
