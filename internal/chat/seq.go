package chat

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"

	"github.com/getstoop/stoop/internal/dbgen"
)

// The channel log (docs/architecture/channel-log.md): every write that
// changes how a message renders takes the channel's next seq and stamps
// the row with it, in the write's own transaction. The stamp comes first
// in that transaction, so every RPC transaction that writes message rows
// takes the channel row before any message row (LockChannel, a
// NextChannelSeq that is its first statement as in pin, or
// LockChannelNoKey on the membership paths below), and no two of them
// wait on each other's rows. A removal from a space is the one exception
// to "first", below. The retention sweep, the one hard delete, holds the
// channel row the same way (retention_sweep.go).
//
// A transaction that holds more than one channel row takes them in id
// order: a removal from a space locks each private channel the person
// was in (lockPrivateChannelsOf), and a reorder updates every channel of
// the space (ReorderChannels). Two of them taking the same rows in
// different orders would deadlock, and Postgres would fail one. The
// retention sweep holds one channel per transaction and sorts its
// channels too. Deleting a space is the exception: its cascade takes the
// channels in whatever order it finds them.
//
// One row may come before the channel rows: a removal from a space
// takes the departing person's own space_members row first
// (removeMember), so nobody can add them to a private channel while it
// lists theirs. It then holds those channels FOR NO KEY UPDATE
// (LockChannelNoKey), which shuts out every other writer of a channel
// but lets a foreign-key check through, so nothing that only points a
// new row at the channel (an alert, a read marker) waits on it. Adding
// people to a private channel and taking one person out of it
// (addMembers, removeFromChannel) hold their one channel the same way,
// for the same reason; an add against a space delete is among the
// accepted cases below. After the locks the removal waits only on rows
// its own statements and cascade take: the person's activity items, channel memberships and
// group memberships. Whoever holds one of those must not then wait on a
// departing person's membership. Saving a group (UpdateGroup) is the
// one writer of those rows that also checks memberships, so it writes
// only the difference, never touching a member who stays, and adds its
// new members (each a membership check) before it deletes any row, so
// it holds none of them while it waits. Nothing else may take a row
// before the channel rows.
//
// Accepted, each failing one transaction whole with a deadlock error:
//   - Between the removal listing a channel and locking it (which
//     includes waiting on its lower-id channels), the person is taken
//     out of it and added straight back. The re-add waits on the
//     membership; the removal waits on the channel.
//   - A space delete against anything that holds a channel or group row
//     and then checks a membership, or holds channels in another order:
//     a reorder, an add to a private channel, a group save. The delete's
//     cascade takes memberships, channels and groups in its own order.
//   - A ban whose removal is the one that fails: BanMember commits the
//     ban first, so the person is banned but still a member; the caller
//     gets the error, and banning again finishes it.
// A space delete against a removal does not deadlock: the cascade
// reaches space_members before channels, and waits on the membership.

// errMessageGone is the row to stamp no longer existing. It rolls the
// transaction back, so the position it took is not spent. stampMessage
// wraps it as NotFound, a fresh connect error per call since one carries
// mutable headers; callers match it with errors.Is.
var errMessageGone = errors.New("message not found")

// errUnchanged is a write that found nothing to change, returned from
// inside a transaction so the position it took is not spent.
var errUnchanged = errors.New("nothing changed")

// stampMessage gives messageID the channel's next log position and
// returns it.
func stampMessage(ctx context.Context, qtx *dbgen.Queries, channelID, messageID string) (int64, error) {
	seq, err := qtx.NextChannelSeq(ctx, channelID)
	if err != nil {
		return 0, fmt.Errorf("next channel seq: %w", err)
	}
	stamped, err := qtx.StampMessageSeq(ctx, dbgen.StampMessageSeqParams{ID: messageID, Seq: seq})
	if err != nil {
		return 0, fmt.Errorf("stamp message seq: %w", err)
	}
	if stamped == 0 {
		return 0, connect.NewError(connect.CodeNotFound, errMessageGone)
	}
	return seq, nil
}
