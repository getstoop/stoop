package chat

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/dbgen"
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

// PendingActivity is an item as the feed would show it now (its actor
// and its preview from the message as it now reads), or nil when it is no
// longer worth a notification to its recipient: no longer theirs or
// unread (read, refreshed under a newer id, or deleted with its message,
// a block, or a channel they lost), in a channel they can no longer read,
// or muted for them now.
func (s *Service) PendingActivity(ctx context.Context, userID, itemID string) (*chatv1.ActivityItem, error) {
	row, err := s.q.GetPendingActivityItem(ctx, dbgen.GetPendingActivityItemParams{ID: itemID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get activity item: %w", err)
	}
	if row.Muted || row.MessageContent == nil {
		return nil, nil
	}
	items, err := s.renderActivity(ctx, []dbgen.ListActivityRow{dbgen.ListActivityRow(row)})
	if err != nil {
		return nil, err
	}
	return items[0], nil
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
