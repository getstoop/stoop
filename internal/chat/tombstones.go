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

// liveMessage reads a write's target again inside the transaction, once
// the channel row is held: the handler checked it before the transaction
// began, and a delete can commit in between, which no foreign key stops
// now that a delete is a tombstone. It answers as the handler's own check
// does: a hidden tombstone is NotFound, a placeholder is refused. Either
// rolls the transaction back, so a position taken is not spent.
func liveMessage(ctx context.Context, qtx *dbgen.Queries, messageID string) (messageRow, error) {
	row, err := qtx.GetMessage(ctx, messageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return messageRow{}, connect.NewError(connect.CodeNotFound, errMessageGone)
	}
	if err != nil {
		return messageRow{}, fmt.Errorf("read message: %w", err)
	}
	if row.DeletedAt != nil {
		return messageRow{}, placeholderError()
	}
	return row, nil
}

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

// removedRow is a row a delete took with it, and the position that
// stamped it.
type removedRow struct {
	id  string
	seq int64
}

// removePinRows tombstones the pin rows about a message being deleted, as
// an admin's delete of a system row does, under the channel lock the
// caller holds. They are quiet, so the channel's newest message stays.
func removePinRows(ctx context.Context, qtx *dbgen.Queries, channelID, messageID string) ([]removedRow, error) {
	ids, err := qtx.ListLiveRowsAbout(ctx, dbgen.ListLiveRowsAboutParams{MessageID: messageID, Kind: kindMessagePinned})
	if err != nil {
		return nil, fmt.Errorf("list pin rows: %w", err)
	}
	removed := make([]removedRow, 0, len(ids))
	for _, id := range ids {
		seq, err := tombstoneRow(ctx, qtx, channelID, id)
		if err != nil {
			return nil, err
		}
		removed = append(removed, removedRow{id: id, seq: seq})
	}
	return removed, nil
}

// publishRemoved tells the channel the rows a delete took with it went,
// after whatever the delete itself published, since their seqs follow.
func (s *Service) publishRemoved(ctx context.Context, channel dbgen.Channel, rows []removedRow) {
	for _, row := range rows {
		s.publishChannel(ctx, channel, messageDeleted(row.id, channel, "", row.seq))
	}
}

// tombstoneMessage deletes one message, in the channel's transaction, and
// tells the channel what the old client expects: message_deleted where
// the row vanished, message_updated for a root kept as a placeholder, and
// thread_changed when a reply's root keeps its summary; then
// message_deleted for a top-level message's pin rows. The files go
// through the port once the transaction has committed.
func (s *Service) tombstoneMessage(ctx context.Context, msg messageRow, channel dbgen.Channel) error {
	fileIDs, err := s.q.ListAttachmentFileIDsForMessage(ctx, msg.ID)
	if err != nil {
		return fmt.Errorf("list attachments: %w", err)
	}
	var (
		seq         int64 // the tombstone's position
		placeholder bool  // a root kept, since its thread has live replies
		reply       replyTombstone
		pinRows     []removedRow
	)
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		if _, err := qtx.LockChannel(ctx, channel.ID); err != nil {
			return fmt.Errorf("lock channel: %w", err)
		}
		var err error
		if msg.ThreadRootID == nil {
			seq, placeholder, pinRows, err = tombstoneTopLevel(ctx, qtx, channel.ID, msg.ID)
			return err
		}
		reply, err = tombstoneReply(ctx, qtx, channel.ID, msg)
		seq = reply.seq
		return err
	})
	if err != nil {
		return err
	}
	s.deleteMessageFiles(ctx, fileIDs)

	if msg.ThreadRootID == nil {
		s.publishTopLevelDelete(ctx, channel, msg.ID, seq, placeholder)
		s.publishRemoved(ctx, channel, pinRows)
		return nil
	}
	rootID := *msg.ThreadRootID
	s.publishChannel(ctx, channel, messageDeleted(msg.ID, channel, rootID, seq))
	if reply.rootGone {
		s.publishChannel(ctx, channel, messageDeleted(rootID, channel, "", reply.rootSeq))
	} else if ev := s.threadChanged(ctx, channel, rootID, reply.thread, reply.rootSeq); ev != nil {
		s.publishChannel(ctx, channel, ev)
	}
	return nil
}

// publishTopLevelDelete is message_deleted for a top-level row that
// vanished, or message_updated for a root kept as a placeholder.
func (s *Service) publishTopLevelDelete(ctx context.Context, channel dbgen.Channel, messageID string, seq int64, placeholder bool) {
	if !placeholder {
		s.publishChannel(ctx, channel, messageDeleted(messageID, channel, "", seq))
		return
	}
	out, err := s.loadMessage(ctx, messageID, spaceOf(channel))
	if err != nil {
		slog.Default().Warn("delete: could not reload placeholder", "message_id", messageID, "err", err)
		return
	}
	s.publishChannel(ctx, channel, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MessageUpdated{MessageUpdated: out},
	}))
}

// tombstoneTopLevel tombstones a top-level message, and its pin rows
// after it, under the channel lock. It returns the tombstone's position,
// whether the row is kept as a placeholder (its thread has live replies,
// so it stays shown and the summary stays with it) and the pin rows.
func tombstoneTopLevel(ctx context.Context, qtx *dbgen.Queries, channelID, messageID string) (int64, bool, []removedRow, error) {
	replies, err := qtx.LockThread(ctx, messageID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil, fmt.Errorf("lock thread: %w", err)
	}
	seq, err := tombstoneRow(ctx, qtx, channelID, messageID)
	if err != nil {
		return 0, false, nil, err
	}
	pinRows, err := removePinRows(ctx, qtx, channelID, messageID)
	if err != nil {
		return 0, false, nil, err
	}
	if replies > 0 {
		return seq, true, pinRows, nil
	}
	return seq, false, pinRows, hideRoot(ctx, qtx, channelID, messageID)
}

// replyTombstone is what deleting a reply did to the thread: the reply's
// own position, the root's new one (its summary changed, or it went), the
// summary when replies remain, and whether the root, a placeholder, went
// with its last reply.
type replyTombstone struct {
	seq      int64
	rootSeq  int64
	thread   *dbgen.Thread
	rootGone bool
}

// tombstoneReply tombstones a reply under the channel lock and recounts
// its root's summary over the live replies.
func tombstoneReply(ctx context.Context, qtx *dbgen.Queries, channelID string, msg messageRow) (replyTombstone, error) {
	var out replyTombstone
	rootID := *msg.ThreadRootID
	if _, err := qtx.LockThread(ctx, rootID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return out, fmt.Errorf("lock thread: %w", err)
	}
	// The root under the lock, while its thread still has this reply.
	root, err := qtx.GetMessage(ctx, rootID)
	if err != nil {
		return out, fmt.Errorf("load root: %w", err)
	}
	if out.seq, err = tombstoneRow(ctx, qtx, channelID, msg.ID); err != nil {
		return out, err
	}
	if msg.InChannel {
		if err := qtx.RecomputeChannelLastMessage(ctx, channelID); err != nil {
			return out, fmt.Errorf("recompute channel: %w", err)
		}
	}
	recounted, err := qtx.RecomputeThread(ctx, rootID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return out, fmt.Errorf("recount thread: %w", err)
	}
	if err == nil && recounted.ReplyCount > 0 {
		// The root's summary changed with it.
		out.thread = &recounted
		out.rootSeq, err = stampMessage(ctx, qtx, channelID, rootID)
		return out, err
	}
	if err := qtx.DeleteThreadSummary(ctx, rootID); err != nil {
		return out, fmt.Errorf("delete thread summary: %w", err)
	}
	if out.rootSeq, err = stampMessage(ctx, qtx, channelID, rootID); err != nil {
		return out, err
	}
	if root.DeletedAt == nil {
		// The summary under it went; the root itself stays.
		return out, nil
	}
	// The placeholder has nothing left to stand for.
	out.rootGone = true
	return out, hideRoot(ctx, qtx, channelID, rootID)
}

// hideRoot is what follows a top-level tombstone nobody is shown any
// more: the thread's mutes and read markers go, as a hard delete took
// them, so does a pin (a pinned row would be listed empty and kept from
// the sweep), and the channel's newest message is read again.
func hideRoot(ctx context.Context, qtx *dbgen.Queries, channelID, rootID string) error {
	if err := qtx.DeleteThreadViewerRows(ctx, rootID); err != nil {
		return fmt.Errorf("delete thread viewer rows: %w", err)
	}
	if _, err := qtx.UnpinMessage(ctx, rootID); err != nil {
		return fmt.Errorf("unpin hidden root: %w", err)
	}
	if err := qtx.RecomputeChannelLastMessage(ctx, channelID); err != nil {
		return fmt.Errorf("recompute channel: %w", err)
	}
	return nil
}

// tombstoneThread is Delete thread's transaction: every live reply and
// then the root, each with its own seq, then the root's pin rows, the
// summary dropped, the thread's viewer rows gone. A root that is a
// placeholder already is only stamped, since it vanishes; its pin rows
// went when it became one. It returns the root's position and the pin
// rows.
func tombstoneThread(ctx context.Context, qtx *dbgen.Queries, channelID string, root messageRow) (int64, []removedRow, error) {
	if _, err := qtx.LockChannel(ctx, channelID); err != nil {
		return 0, nil, fmt.Errorf("lock channel: %w", err)
	}
	if _, err := qtx.LockThread(ctx, root.ID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, fmt.Errorf("lock thread: %w", err)
	}
	replies, err := qtx.ListLiveThreadReplies(ctx, root.ID)
	if err != nil {
		return 0, nil, fmt.Errorf("list replies: %w", err)
	}
	for _, replyID := range replies {
		if _, err := tombstoneRow(ctx, qtx, channelID, replyID); err != nil {
			return 0, nil, err
		}
	}
	var rootSeq int64
	if root.DeletedAt == nil {
		rootSeq, err = tombstoneRow(ctx, qtx, channelID, root.ID)
	} else {
		rootSeq, err = stampMessage(ctx, qtx, channelID, root.ID)
	}
	if err != nil {
		return 0, nil, err
	}
	pinRows, err := removePinRows(ctx, qtx, channelID, root.ID)
	if err != nil {
		return 0, nil, err
	}
	if err := qtx.DeleteThreadSummary(ctx, root.ID); err != nil {
		return 0, nil, fmt.Errorf("delete thread summary: %w", err)
	}
	return rootSeq, pinRows, hideRoot(ctx, qtx, channelID, root.ID)
}
