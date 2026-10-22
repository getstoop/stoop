package chat

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Catching up: a client holding a channel's seq asks ListChanges for every
// row stamped after it, tombstones and thread replies included, and
// applies each by "higher seq wins". The retention floor tells it which
// held rows the sweep has taken, or will. docs/architecture/messaging.md →
// History.

const (
	defaultChangesPageSize = 100
	maxChangesPageSize     = 200
)

// ListChanges is the channel log from since_seq, in seq order, under the
// same gate as ListMessages.
func (s *Service) ListChanges(ctx context.Context, req *connect.Request[chatv1.ListChangesRequest]) (*connect.Response[chatv1.ListChangesResponse], error) {
	channel, err := s.accessChannel(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	if err := requireChannelAction(ctx, channel, authctx.MessagesRead, authctx.DMsRead); err != nil {
		return nil, err
	}
	limit := clampPageSize(req.Msg.Limit, defaultChangesPageSize, maxChangesPageSize)
	// channel.Seq was read with the channel row, before the rows: anything
	// committing after it has a higher seq and reaches the client as a
	// later change.
	rows, err := s.q.ListMessageChanges(ctx, dbgen.ListMessageChangesParams{
		ChannelID: channel.ID, SinceSeq: req.Msg.SinceSeq, Limit: limit,
	})
	if err != nil {
		return nil, fmt.Errorf("list changes: %w", err)
	}
	messages, err := s.hydrateMessages(ctx, spaceOf(channel), rows)
	if err != nil {
		return nil, err
	}
	if err := s.addThreadViewerStates(ctx, messages); err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.ListChangesResponse{
		Messages: messages, ChannelSeq: channel.Seq, HasMore: int32(len(rows)) == limit,
		RetentionFloorId: s.retentionFloorID(ctx, time.Now()),
	}), nil
}

// retentionFloor is the message id below which the sweep removes
// top-level messages, as of now with a period of days: the one cutoff the
// sweep and the list RPCs share, so they can never disagree.
func retentionFloor(now time.Time, days int) string {
	return cutoffID(retentionCutoff(now, days))
}

// retentionFloorID is retentionFloor under the instance's policy; "" when
// retention is off. The floor is advisory, so a setting that can't be
// read is logged and means none, never a failed list: the next answer
// carries it.
func (s *Service) retentionFloorID(ctx context.Context, now time.Time) string {
	if s.policy == nil {
		return ""
	}
	days, err := s.policy.MessageRetentionDays(ctx)
	if err != nil {
		slog.Default().Warn("could not read the retention setting", "err", err)
		return ""
	}
	if days <= 0 {
		return ""
	}
	return retentionFloor(now, days)
}
