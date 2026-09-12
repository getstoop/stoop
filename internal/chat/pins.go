package chat

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

// maxChannelPins bounds a channel's pin list, which is what lets the list
// be one query with no paging. At the cap a pin is refused rather than
// evicting the oldest. See docs/proposals/pinned-messages.md.
const maxChannelPins = 50

// SetMessagePinned pins or unpins a message in a space channel. Setting
// the state it already has is a no-op that broadcasts nothing.
func (s *Service) SetMessagePinned(ctx context.Context, req *connect.Request[chatv1.SetMessagePinnedRequest]) (*connect.Response[chatv1.SetMessagePinnedResponse], error) {
	msg, err := s.q.GetMessage(ctx, req.Msg.MessageId)
	if err != nil {
		return nil, notFoundOr(err, "message")
	}
	channel, err := s.q.GetChannel(ctx, msg.ChannelID)
	if err != nil {
		return nil, notFoundOr(err, "channel")
	}
	if isDM(channel) {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("direct messages don't have pinned messages"))
	}
	if err := s.requirePermission(ctx, *channel.SpaceID, PermManageChannels); err != nil {
		return nil, err
	}
	if req.Msg.Pinned {
		return s.pin(ctx, msg, channel)
	}
	return s.unpin(ctx, msg, channel)
}

func (s *Service) pin(ctx context.Context, msg dbgen.Message, channel dbgen.Channel) (*connect.Response[chatv1.SetMessagePinnedResponse], error) {
	row, err := s.q.PinMessage(ctx, dbgen.PinMessageParams{
		MessageID: msg.ID, ChannelID: channel.ID,
		PinnedBy: authctx.UserID(ctx), Cap: maxChannelPins,
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// The insert wrote nothing: either it is pinned already, or the
		// channel is full. One read tells them apart.
		row, err = s.q.GetPin(ctx, msg.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, connect.NewError(connect.CodeFailedPrecondition,
				fmt.Errorf("this channel has %d pinned messages; unpin one first", maxChannelPins))
		}
		if err != nil {
			return nil, fmt.Errorf("get pin: %w", err)
		}
	case err != nil:
		return nil, fmt.Errorf("pin message: %w", err)
	default:
		s.publishPin(ctx, channel, row, true)
	}

	pin, err := s.pinProto(ctx, msg, channel, row)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.SetMessagePinnedResponse{Pin: pin}), nil
}

func (s *Service) unpin(ctx context.Context, msg dbgen.Message, channel dbgen.Channel) (*connect.Response[chatv1.SetMessagePinnedResponse], error) {
	removed, err := s.q.UnpinMessage(ctx, msg.ID)
	if err != nil {
		return nil, fmt.Errorf("unpin message: %w", err)
	}
	if removed > 0 {
		s.publishPin(ctx, channel, dbgen.ChannelPin{MessageID: msg.ID, ChannelID: channel.ID}, false)
	}
	return connect.NewResponse(&chatv1.SetMessagePinnedResponse{}), nil
}

// ListPinnedMessages returns a channel's pins, most recently pinned
// first. Any member of the channel may read them.
func (s *Service) ListPinnedMessages(ctx context.Context, req *connect.Request[chatv1.ListPinnedMessagesRequest]) (*connect.Response[chatv1.ListPinnedMessagesResponse], error) {
	channel, err := s.accessChannel(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListChannelPins(ctx, dbgen.ListChannelPinsParams{
		ChannelID: channel.ID, Lim: maxChannelPins,
	})
	if err != nil {
		return nil, fmt.Errorf("list pins: %w", err)
	}
	if len(rows) == 0 {
		return connect.NewResponse(&chatv1.ListPinnedMessagesResponse{}), nil
	}

	// The messages hydrate through the one path, which reverses the rows
	// it is given; reverse back so the response reads newest pin first.
	msgRows := make([]dbgen.ListMessagesBeforeRow, len(rows))
	pinnerIDs := make([]string, len(rows))
	for i, r := range rows {
		msgRows[i] = dbgen.ListMessagesBeforeRow{
			Message:          r.Message,
			ReplyAuthorID:    r.ReplyAuthorID,
			ReplyContent:     r.ReplyContent,
			ReplyFirstFileID: r.ReplyFirstFileID,
		}
		pinnerIDs[i] = r.PinnedBy
	}
	messages, err := s.hydrateMessages(ctx, spaceOf(channel), msgRows)
	if err != nil {
		return nil, err
	}
	pinners, err := s.resolveAuthors(ctx, pinnerIDs)
	if err != nil {
		return nil, err
	}

	pins := make([]*chatv1.PinnedMessage, len(rows))
	for i, r := range rows {
		pins[i] = &chatv1.PinnedMessage{
			Message:  messages[len(rows)-1-i],
			PinnedBy: pinners[r.PinnedBy],
			PinnedAt: timestamppb.New(r.PinnedAt),
		}
	}
	return connect.NewResponse(&chatv1.ListPinnedMessagesResponse{Pins: pins}), nil
}

// pinnedByMessage reports which of a page of messages are pinned, so the
// timeline can mark them without a join on the hot path.
func (s *Service) pinnedByMessage(ctx context.Context, messageIDs []string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(messageIDs) == 0 {
		return out, nil
	}
	ids, err := s.q.PinnedMessageIDs(ctx, messageIDs)
	if err != nil {
		return nil, fmt.Errorf("list pinned ids: %w", err)
	}
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}

// pinProto renders one pin for the RPC that made it.
func (s *Service) pinProto(ctx context.Context, msg dbgen.Message, channel dbgen.Channel, row dbgen.ChannelPin) (*chatv1.PinnedMessage, error) {
	out, err := s.loadMessage(ctx, msg, spaceOf(channel))
	if err != nil {
		return nil, err
	}
	out.Pinned = true
	pinners, err := s.resolveAuthors(ctx, []string{row.PinnedBy})
	if err != nil {
		return nil, err
	}
	return &chatv1.PinnedMessage{
		Message:  out,
		PinnedBy: pinners[row.PinnedBy],
		PinnedAt: timestamppb.New(row.PinnedAt),
	}, nil
}

// publishPin broadcasts the change, not the list: a channel's pins can be
// fifty full messages, and whoever shows them asks for them.
func (s *Service) publishPin(ctx context.Context, channel dbgen.Channel, row dbgen.ChannelPin, pinned bool) {
	ev := &realtimev1.MessagePinned{
		SpaceId: spaceOf(channel), ChannelId: channel.ID,
		MessageId: row.MessageID, Pinned: pinned,
	}
	if pinned {
		pinners, err := s.resolveAuthors(ctx, []string{row.PinnedBy})
		if err == nil {
			ev.PinnedBy = pinners[row.PinnedBy]
		}
		ev.PinnedAt = timestamppb.New(row.PinnedAt)
	}
	s.publishChannel(ctx, channel, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MessagePinned{MessagePinned: ev},
	}))
}
