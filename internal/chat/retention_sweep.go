package chat

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/dbgen"
)

// Message retention: messages older than the instance's
// message_retention_days go, pinned ones excepted, with everything that
// cascades from a message and their attachments' files. A thread goes by
// its root's age, replies and all. Tombstones past the cutoff are rows
// like any other. This is the one hard delete of message rows outside
// deleting a channel or a space, and it holds the channel row like every
// other message write (seq.go), recording in channels.swept_seq the
// highest seq it removed. No events are published; clients see the gap
// on their next load. See docs/architecture/messaging.md#message-retention.

const (
	retentionBatch = 1000
	// RetentionInterval is how often both retention sweeps run.
	RetentionInterval = time.Hour
)

// cutoffID is the smallest UUIDv7 for the instant: every message id
// below it was made earlier.
func cutoffID(t time.Time) string {
	var u uuid.UUID
	ms := uint64(t.UnixMilli())
	binary.BigEndian.PutUint16(u[0:2], uint16(ms>>32))
	binary.BigEndian.PutUint32(u[2:6], uint32(ms))
	u[6] = 0x70
	u[8] = 0x80
	return u.String()
}

func retentionCutoff(now time.Time, days int) time.Time {
	return now.Add(-time.Duration(days) * 24 * time.Hour)
}

// CountExpiredMessages is what SweepMessages would delete at now with a
// period of days. Exposed for the instance module's PreviewRetention.
func (s *Service) CountExpiredMessages(ctx context.Context, now time.Time, days int) (int64, error) {
	if days <= 0 {
		return 0, nil
	}
	return s.q.CountExpiredMessages(ctx, retentionFloor(now, days))
}

// SweepMessages deletes the messages the retention setting no longer
// keeps, as of now, and reports how many went.
func (s *Service) SweepMessages(ctx context.Context, now time.Time) (int64, error) {
	if s.policy == nil {
		return 0, nil
	}
	days, err := s.policy.MessageRetentionDays(ctx)
	if err != nil || days <= 0 {
		return 0, err
	}
	cutoff := retentionFloor(now, days)
	var removed int64
	for {
		rows, err := s.q.ListExpiredMessages(ctx, dbgen.ListExpiredMessagesParams{Cutoff: cutoff, Limit: retentionBatch})
		if err != nil {
			return removed, fmt.Errorf("list expired messages: %w", err)
		}
		if len(rows) == 0 {
			break
		}
		ids := make([]string, len(rows))
		byChannel := map[string][]string{}
		for index, row := range rows {
			ids[index] = row.ID
			byChannel[row.ChannelID] = append(byChannel[row.ChannelID], row.ID)
		}
		fileIDs, err := s.q.ListThreadFileIDsForRoots(ctx, ids)
		if err != nil {
			return removed, fmt.Errorf("list expired attachments: %w", err)
		}
		// One transaction per channel, channels in one order, so two
		// sweeps (or a sweep and a channel delete) never wait on each
		// other's rows.
		for _, channelID := range slices.Sorted(maps.Keys(byChannel)) {
			count, err := s.sweepChannel(ctx, channelID, byChannel[channelID])
			if err != nil {
				return removed, err
			}
			removed += count
		}
		s.deleteMessageFiles(ctx, fileIDs)
		if len(rows) < retentionBatch {
			break
		}
	}
	if removed > 0 {
		slog.Default().Info("messages past retention deleted", "removed", removed, "days", days)
	}
	return removed, nil
}

// sweepChannel hard-deletes these roots of one channel and every reply
// under them, holding the channel row first, and raises swept_seq to the
// highest seq among the rows removed. A channel deleted meanwhile took
// its rows with it: nothing to do.
func (s *Service) sweepChannel(ctx context.Context, channelID string, rootIDs []string) (int64, error) {
	var removed int64
	err := s.inTx(ctx, func(qtx *dbgen.Queries) error {
		if _, err := qtx.LockChannel(ctx, channelID); err != nil {
			return fmt.Errorf("lock channel: %w", err)
		}
		result, err := qtx.DeleteExpiredMessages(ctx, rootIDs)
		if err != nil {
			return fmt.Errorf("delete expired messages: %w", err)
		}
		removed = result.Removed
		if err := qtx.RaiseChannelSweptSeq(ctx, dbgen.RaiseChannelSweptSeqParams{ID: channelID, Seq: result.MaxSeq}); err != nil {
			return fmt.Errorf("raise swept seq: %w", err)
		}
		if err := qtx.RecomputeChannelLastMessage(ctx, channelID); err != nil {
			return fmt.Errorf("recompute last message: %w", err)
		}
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return removed, err
}

// SweepMessagesKind is the job kind internal/app registers for SweepMessages.
const SweepMessagesKind = "sweep_messages"
