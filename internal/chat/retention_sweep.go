package chat

import (
	"context"
	"encoding/binary"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/diag"
)

// Message retention: messages older than the instance's
// message_retention_days go, pinned ones excepted, with everything that
// cascades from a message and their attachments' files. No events are
// published; clients see the gap on their next load. See
// docs/architecture/messaging.md#message-retention.

const (
	retentionBatch      = 1000
	retentionSweepDelay = 3 * time.Minute
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
	return s.q.CountExpiredMessages(ctx, cutoffID(retentionCutoff(now, days)))
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
	cutoff := cutoffID(retentionCutoff(now, days))
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
		channels := map[string]bool{}
		for i, r := range rows {
			ids[i] = r.ID
			channels[r.ChannelID] = true
		}
		fileIDs, err := s.q.ListAttachmentFileIDsForMessages(ctx, ids)
		if err != nil {
			return removed, fmt.Errorf("list expired attachments: %w", err)
		}
		if err := s.q.DeleteMessagesByIDs(ctx, ids); err != nil {
			return removed, fmt.Errorf("delete expired messages: %w", err)
		}
		removed += int64(len(ids))
		for id := range channels {
			if err := s.q.RecomputeChannelLastMessage(ctx, id); err != nil {
				return removed, fmt.Errorf("recompute last message: %w", err)
			}
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

var messageRetention = diag.NewJob("message_retention")

// RunMessageSweeper runs SweepMessages hourly until ctx ends.
func (s *Service) RunMessageSweeper(ctx context.Context) {
	messageRetention.Every(RetentionInterval)
	run := func() {
		messageRetention.Run(func() (diag.Counters, error) {
			n, err := s.SweepMessages(ctx, time.Now())
			if err != nil && ctx.Err() == nil {
				slog.Default().Warn("message retention sweep failed", "err", err)
			}
			return diag.Counters{"messages_removed": n}, err
		})
	}
	select {
	case <-ctx.Done():
		return
	case <-time.After(retentionSweepDelay):
		run()
	}
	t := time.NewTicker(RetentionInterval)
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
