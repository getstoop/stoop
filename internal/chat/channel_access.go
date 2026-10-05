package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

func isDM(c dbgen.Channel) bool { return c.SpaceID == nil }

// spaceOf is the channel's space id, "" for a direct message. Events and
// protos carry that "" so clients can tell the two apart.
func spaceOf(c dbgen.Channel) string {
	if c.SpaceID == nil {
		return ""
	}
	return *c.SpaceID
}

// accessChannel loads a channel the caller may read: a member of its
// space, or a participant in the direct message. Membership is checked
// before the row is read so an outsider learns nothing from the error.
// A hidden voice channel is not found.
func (s *Service) accessChannel(ctx context.Context, channelID string) (dbgen.Channel, error) {
	if err := s.requireChannelMember(ctx, channelID); err != nil {
		return dbgen.Channel{}, err
	}
	return s.memberChannel(ctx, channelID)
}

// writableChannel loads a channel the caller may write in: accessChannel,
// plus the block rule in a direct message. Every RPC that adds to or
// changes what the other side sees — send, edit, react — goes through
// this one, so a kick, a ban or a block stops all three together. A
// direct message's participants come back with it, nil for a space
// channel, for the rest of the request to use.
func (s *Service) writableChannel(ctx context.Context, channelID string) (dbgen.Channel, []string, error) {
	channel, err := s.accessChannel(ctx, channelID)
	if err != nil {
		return dbgen.Channel{}, nil, err
	}
	if err := requireChannelAction(ctx, channel, authctx.MessagesPost, authctx.DMsPost); err != nil {
		return dbgen.Channel{}, nil, err
	}
	if !isDM(channel) {
		return channel, nil, nil
	}
	participants, err := s.q.ListDMMembers(ctx, channel.ID)
	if err != nil {
		return dbgen.Channel{}, nil, fmt.Errorf("list participants: %w", err)
	}
	blocked, err := s.dmBlocked(ctx, participants, authctx.UserID(ctx))
	if err != nil {
		return dbgen.Channel{}, nil, err
	}
	if blocked {
		return dbgen.Channel{}, nil, blockRefusal(len(participants), errBlockedGroupSend)
	}
	return channel, participants, nil
}

// publishChannel delivers an event to everyone who can see the channel:
// the space's topic, or each DM participant's personal topic (which
// every connection already subscribes to, so the gateway needs no DM
// bookkeeping).
func (s *Service) publishChannel(ctx context.Context, channel dbgen.Channel, ev *realtimev1.ServerEvent) {
	var participants []string
	if isDM(channel) {
		ids, err := s.q.ListDMMembers(ctx, channel.ID)
		if err != nil {
			slog.Default().Warn("dm: could not list participants for event", "channel_id", channel.ID, "err", err)
			return
		}
		participants = ids
	}
	s.publishTo(channel, participants, ev)
}

// publishTo is publishChannel with a direct message's participants
// already in hand, as writableChannel returns them.
func (s *Service) publishTo(channel dbgen.Channel, participants []string, ev *realtimev1.ServerEvent) {
	if !isDM(channel) {
		s.bus.Publish(events.SpaceTopic(*channel.SpaceID), ev)
		return
	}
	for _, id := range participants {
		s.bus.Publish(events.UserTopic(id), ev)
	}
}

// memberChannel loads a channel for someone already known to be in it. A
// hidden voice channel is not found.
func (s *Service) memberChannel(ctx context.Context, channelID string) (dbgen.Channel, error) {
	channel, err := s.q.GetChannel(ctx, channelID)
	if err != nil {
		return dbgen.Channel{}, apierr.NotFoundOr(err, "channel")
	}
	hidden, err := s.hiddenChannel(ctx, channel)
	if err != nil {
		return dbgen.Channel{}, err
	}
	if hidden {
		return dbgen.Channel{}, connect.NewError(connect.CodeNotFound, errors.New("channel not found"))
	}
	return channel, nil
}

// listChannels is a space's channels as its members see them.
func (s *Service) listChannels(ctx context.Context, spaceID, userID string) ([]dbgen.ListChannelsBySpaceRow, error) {
	rows, err := s.q.ListChannelsBySpace(ctx, dbgen.ListChannelsBySpaceParams{
		SpaceID: spaceID, UserID: userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list channels: %w", err)
	}
	on, err := s.voiceOn(ctx, spaceID)
	if err != nil || on {
		return rows, err
	}
	shown := rows[:0]
	for _, row := range rows {
		if !isVoice(row.Channel) {
			shown = append(shown, row)
		}
	}
	return shown, nil
}
