package chat

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"

	"github.com/getstoop/stoop/internal/dbgen"
)

// The channel log (docs/proposals/channel-log.md): every write that
// changes how a message renders takes the channel's next seq and stamps
// the row with it, in the write's own transaction. The stamp comes first
// in that transaction, so every transaction that writes message rows
// takes the channel row (NextChannelSeq, or LockChannel where a delete
// may not stamp) before any message row, and no two of them wait on each
// other's rows.

// errMessageGone is the row to stamp no longer existing. It rolls the
// transaction back, so the position it took is not spent, and reads as
// NotFound when an RPC returns it.
var errMessageGone = connect.NewError(connect.CodeNotFound, errors.New("message not found"))

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
		return 0, errMessageGone
	}
	return seq, nil
}
