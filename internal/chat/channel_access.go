package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

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

// people is who a channel's events go to by name: a direct message's
// participants or a private channel's people. nil for a public channel,
// whose events go to its space with no lookup.
func (s *Service) people(ctx context.Context, channel dbgen.Channel) ([]string, error) {
	switch {
	case isDM(channel):
		return s.q.ListDMMembers(ctx, channel.ID)
	case channel.Private:
		return s.q.ListPrivateChannelMemberIDs(ctx, channel.ID)
	default:
		return nil, nil
	}
}

// writableChannel loads a channel the caller may write in: accessChannel,
// plus the block rule in a direct message. Every RPC that adds to or
// changes what the other side sees — send, edit, react — goes through
// this one, so a kick, a ban or a block stops all three together. The
// channel's people come back with it (see people), for the rest of the
// request to use.
func (s *Service) writableChannel(ctx context.Context, channelID string) (dbgen.Channel, []string, error) {
	channel, err := s.accessChannel(ctx, channelID)
	if err != nil {
		return dbgen.Channel{}, nil, err
	}
	if err := requireChannelAction(ctx, channel, authctx.MessagesPost, authctx.DMsPost); err != nil {
		return dbgen.Channel{}, nil, err
	}
	participants, err := s.people(ctx, channel)
	if err != nil {
		return dbgen.Channel{}, nil, fmt.Errorf("list participants: %w", err)
	}
	if !isDM(channel) {
		return channel, participants, nil
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
// the space's topic for a public channel, or the personal topic of each
// person in a direct message or a private channel (which every
// connection already subscribes to, so the gateway keeps no per-channel
// bookkeeping).
func (s *Service) publishChannel(ctx context.Context, channel dbgen.Channel, ev *realtimev1.ServerEvent) {
	participants, err := s.people(ctx, channel)
	if err != nil {
		slog.Default().Warn("could not list a channel's people for an event", "channel_id", channel.ID, "err", err)
		return
	}
	s.publishTo(channel, participants, ev)
}

// publishTo is publishChannel with the channel's people already in hand,
// as writableChannel returns them.
func (s *Service) publishTo(channel dbgen.Channel, participants []string, ev *realtimev1.ServerEvent) {
	if !isDM(channel) && !channel.Private {
		s.bus.Publish(events.SpaceTopic(*channel.SpaceID), ev)
		return
	}
	for _, id := range participants {
		s.bus.Publish(events.UserTopic(id), ev)
	}
}

// notInChannel is the refusal for someone who may not read a channel. A
// private channel is not found, and so is an id that names no channel:
// the two must read the same, or the answer would confirm that a private
// channel exists.
func (s *Service) notInChannel(ctx context.Context, channelID string) error {
	channel, err := s.q.GetChannel(ctx, channelID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && channel.Private) {
		return errChannelNotFound()
	}
	if err != nil {
		return fmt.Errorf("look up channel: %w", err)
	}
	return connect.NewError(connect.CodePermissionDenied,
		errors.New("not a member of this channel's space"))
}

func errChannelNotFound() error {
	return connect.NewError(connect.CodeNotFound, errors.New("channel not found"))
}

// requireInPrivate refuses a caller who is not in a private channel. A
// space permission reaches a public channel on its own; a private one
// also needs the caller in it.
func (s *Service) requireInPrivate(ctx context.Context, channel dbgen.Channel) error {
	if !channel.Private {
		return nil
	}
	ok, err := s.q.IsPrivateChannelMember(ctx, dbgen.IsPrivateChannelMemberParams{
		ChannelID: channel.ID, UserID: authctx.UserID(ctx),
	})
	if err != nil {
		return fmt.Errorf("check channel membership: %w", err)
	}
	if !ok {
		return errChannelNotFound()
	}
	return nil
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
		return dbgen.Channel{}, errChannelNotFound()
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
