package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

// Deleting a message leaves a tombstone: the row stays with deleted_at
// set, no text and nothing hanging off it, stamped with the channel's
// next seq so the channel log carries the delete. Only the retention
// sweep hard-deletes rows (retention_sweep.go). A tombstone is shown to
// nobody, except a root whose thread still has live replies, which the
// channel shows as a placeholder. docs/architecture/messaging.md → Threads.

// tombstoneRow is the one delete path for a message row, inside a
// transaction that already holds the channel row: it blanks the row,
// drops what a hard delete used to cascade, and stamps it. A row that is
// a tombstone already is NotFound, so the position taken is not spent.
func tombstoneRow(ctx context.Context, qtx *dbgen.Queries, channelID, messageID string) (int64, error) {
	changed, err := qtx.TombstoneMessage(ctx, messageID)
	if err != nil {
		return 0, fmt.Errorf("tombstone message: %w", err)
	}
	if changed == 0 {
		return 0, connect.NewError(connect.CodeNotFound, errMessageGone)
	}
	return stampMessage(ctx, qtx, channelID, messageID)
}

// tombstoneMessage deletes one message, in the channel's transaction, and
// tells the channel what the old client expects: message_deleted where
// the row vanished, message_updated for a root kept as a placeholder, and
// thread_changed when a reply's root keeps its summary. The files go
// through the port once the transaction has committed.
func (s *Service) tombstoneMessage(ctx context.Context, msg messageRow, channel dbgen.Channel) error {
	fileIDs, err := s.q.ListAttachmentFileIDsForMessage(ctx, msg.ID)
	if err != nil {
		return fmt.Errorf("list attachments: %w", err)
	}
	var (
		placeholder bool          // a root kept, since its thread has live replies
		rootGone    bool          // a reply's placeholder root lost its last live reply
		thread      *dbgen.Thread // a reply's root summary, when replies remain
	)
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		if _, err := qtx.LockChannel(ctx, channel.ID); err != nil {
			return fmt.Errorf("lock channel: %w", err)
		}
		if msg.ThreadRootID == nil {
			var err error
			placeholder, err = tombstoneTopLevel(ctx, qtx, channel.ID, msg.ID)
			return err
		}
		var err error
		thread, rootGone, err = tombstoneReply(ctx, qtx, channel.ID, msg)
		return err
	})
	if err != nil {
		return err
	}
	s.deleteMessageFiles(ctx, fileIDs)

	if msg.ThreadRootID == nil {
		if !placeholder {
			s.publishChannel(ctx, channel, messageDeleted(msg.ID, channel, ""))
			return nil
		}
		out, err := s.loadMessage(ctx, msg.ID, spaceOf(channel))
		if err != nil {
			slog.Default().Warn("delete: could not reload placeholder", "message_id", msg.ID, "err", err)
			return nil
		}
		s.publishChannel(ctx, channel, events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_MessageUpdated{MessageUpdated: out},
		}))
		return nil
	}
	rootID := *msg.ThreadRootID
	s.publishChannel(ctx, channel, messageDeleted(msg.ID, channel, rootID))
	if rootGone {
		s.publishChannel(ctx, channel, messageDeleted(rootID, channel, ""))
	} else if ev := s.threadChanged(ctx, channel, rootID, thread); ev != nil {
		s.publishChannel(ctx, channel, ev)
	}
	return nil
}

// tombstoneTopLevel tombstones a top-level message under the channel
// lock. It reports whether the row is kept as a placeholder: its thread
// has live replies, so it stays shown and the summary stays with it.
func tombstoneTopLevel(ctx context.Context, qtx *dbgen.Queries, channelID, messageID string) (bool, error) {
	replies, err := qtx.LockThread(ctx, messageID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, fmt.Errorf("lock thread: %w", err)
	}
	if _, err := tombstoneRow(ctx, qtx, channelID, messageID); err != nil {
		return false, err
	}
	if replies > 0 {
		return true, nil
	}
	return false, hideRoot(ctx, qtx, channelID, messageID)
}

// tombstoneReply tombstones a reply under the channel lock and recounts
// its root's summary over the live replies. It returns the summary when
// replies remain, or reports that the root, a placeholder, went with its
// last reply.
func tombstoneReply(ctx context.Context, qtx *dbgen.Queries, channelID string, msg messageRow) (*dbgen.Thread, bool, error) {
	rootID := *msg.ThreadRootID
	if _, err := qtx.LockThread(ctx, rootID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, fmt.Errorf("lock thread: %w", err)
	}
	// The root under the lock, while its thread still has this reply.
	root, err := qtx.GetMessage(ctx, rootID)
	if err != nil {
		return nil, false, fmt.Errorf("load root: %w", err)
	}
	if _, err := tombstoneRow(ctx, qtx, channelID, msg.ID); err != nil {
		return nil, false, err
	}
	if msg.InChannel {
		if err := qtx.RecomputeChannelLastMessage(ctx, channelID); err != nil {
			return nil, false, fmt.Errorf("recompute channel: %w", err)
		}
	}
	recounted, err := qtx.RecomputeThread(ctx, rootID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, fmt.Errorf("recount thread: %w", err)
	}
	if err == nil && recounted.ReplyCount > 0 {
		// The root's summary changed with it.
		_, err := stampMessage(ctx, qtx, channelID, rootID)
		return &recounted, false, err
	}
	if err := qtx.DeleteThreadSummary(ctx, rootID); err != nil {
		return nil, false, fmt.Errorf("delete thread summary: %w", err)
	}
	if root.DeletedAt == nil {
		// The summary under it went; the root itself stays.
		_, err := stampMessage(ctx, qtx, channelID, rootID)
		return nil, false, err
	}
	// The placeholder has nothing left to stand for.
	if _, err := stampMessage(ctx, qtx, channelID, rootID); err != nil {
		return nil, false, err
	}
	return nil, true, hideRoot(ctx, qtx, channelID, rootID)
}

// hideRoot is what follows a top-level tombstone nobody is shown any
// more: the thread's mutes and read markers go, as a hard delete took
// them, and the channel's newest message is read again.
func hideRoot(ctx context.Context, qtx *dbgen.Queries, channelID, rootID string) error {
	if err := qtx.DeleteThreadViewerRows(ctx, rootID); err != nil {
		return fmt.Errorf("delete thread viewer rows: %w", err)
	}
	if err := qtx.RecomputeChannelLastMessage(ctx, channelID); err != nil {
		return fmt.Errorf("recompute channel: %w", err)
	}
	return nil
}

// tombstoneThread is Delete thread's transaction: every live reply and
// then the root, each with its own seq, the summary dropped, the thread's
// viewer rows gone. A root that is a placeholder already is only stamped,
// since it vanishes.
func tombstoneThread(ctx context.Context, qtx *dbgen.Queries, channelID string, root messageRow) error {
	if _, err := qtx.LockChannel(ctx, channelID); err != nil {
		return fmt.Errorf("lock channel: %w", err)
	}
	if _, err := qtx.LockThread(ctx, root.ID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("lock thread: %w", err)
	}
	replies, err := qtx.ListLiveThreadReplies(ctx, root.ID)
	if err != nil {
		return fmt.Errorf("list replies: %w", err)
	}
	for _, replyID := range replies {
		if _, err := tombstoneRow(ctx, qtx, channelID, replyID); err != nil {
			return err
		}
	}
	if root.DeletedAt == nil {
		if _, err := tombstoneRow(ctx, qtx, channelID, root.ID); err != nil {
			return err
		}
	} else if _, err := stampMessage(ctx, qtx, channelID, root.ID); err != nil {
		return err
	}
	if err := qtx.DeleteThreadSummary(ctx, root.ID); err != nil {
		return fmt.Errorf("delete thread summary: %w", err)
	}
	return hideRoot(ctx, qtx, channelID, root.ID)
}
