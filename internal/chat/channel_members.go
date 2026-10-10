package chat

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

var (
	errRequiredNeedsText    = errors.New("only a text channel can be required")
	errDefaultStaysRequired = errors.New("the space's default channel is required; choose another default first")
	errDefaultChannelDelete = errors.New("this is the space's default channel; choose another default first")
	errRequiredChannelLeave = errors.New("everyone in the space is in this channel")
	errJoinNeedsText        = errors.New("only a text channel has members")
	errNotInChannel         = errors.New("join this channel to post in it")
)

// hasMembers is whether a channel keeps a list of people: a space's text
// channel. A voice channel and a direct message do not.
func hasMembers(channel dbgen.Channel) bool {
	return !isDM(channel) && channel.Kind == int16(chatv1.ChannelKind_CHANNEL_KIND_TEXT)
}

// requireInChannel refuses someone who is not in a text channel. Reading
// needs only the space; writing needs the channel.
func (s *Service) requireInChannel(ctx context.Context, userID string, channel dbgen.Channel) error {
	if !hasMembers(channel) {
		return nil
	}
	in, err := s.q.IsInChannel(ctx, dbgen.IsInChannelParams{ChannelID: channel.ID, UserID: userID})
	if err != nil {
		return fmt.Errorf("check channel membership: %w", err)
	}
	if !in {
		return connect.NewError(connect.CodeFailedPrecondition, errNotInChannel)
	}
	return nil
}

// JoinChannel puts the caller in a text channel of a space they belong
// to. The channel arrives read: joining is not a reason to find its whole
// history unread.
func (s *Service) JoinChannel(ctx context.Context, req *connect.Request[chatv1.JoinChannelRequest]) (*connect.Response[chatv1.JoinChannelResponse], error) {
	channel, err := s.accessChannel(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	if !hasMembers(channel) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errJoinNeedsText)
	}
	userID := authctx.UserID(ctx)
	var added []string
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		var err error
		added, err = addMembers(ctx, qtx, channel, []string{userID}, nil, channel.LastMessageID)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("join channel: %w", err)
	}
	s.publishChannelJoined(channel, added)
	out := toProtoChannel(channel)
	out.Joined = true
	if channel.LastMessageID != nil {
		out.LastReadMessageId = *channel.LastMessageID
	}
	return connect.NewResponse(&chatv1.JoinChannelResponse{Channel: out}), nil
}

// LeaveChannel takes the caller out of a text channel, and drops their
// mute on it: a mention brings the channel back, and it should come back
// audible. Leaving one they are not in is not an error.
func (s *Service) LeaveChannel(ctx context.Context, req *connect.Request[chatv1.LeaveChannelRequest]) (*connect.Response[chatv1.LeaveChannelResponse], error) {
	channel, err := s.accessChannel(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	if channel.Required {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errRequiredChannelLeave)
	}
	userID := authctx.UserID(ctx)
	var removed int64
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		var err error
		if removed, err = qtx.RemoveChannelMember(ctx, dbgen.RemoveChannelMemberParams{ChannelID: channel.ID, UserID: userID}); err != nil {
			return err
		}
		return qtx.UnmuteChannel(ctx, dbgen.UnmuteChannelParams{UserID: userID, ChannelID: channel.ID})
	})
	if err != nil {
		return nil, fmt.Errorf("leave channel: %w", err)
	}
	if removed > 0 {
		s.bus.Publish(events.UserTopic(userID), events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_ChannelMuted{
				ChannelMuted: &realtimev1.ChannelMuted{SpaceId: spaceOf(channel), ChannelId: channel.ID},
			},
		}))
		s.bus.Publish(events.SpaceTopic(spaceOf(channel)), events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_ChannelMemberLeft{
				ChannelMemberLeft: &realtimev1.ChannelMemberLeft{SpaceId: spaceOf(channel), ChannelId: channel.ID, UserId: userID},
			},
		}))
	}
	return connect.NewResponse(&chatv1.LeaveChannelResponse{}), nil
}

// ListChannelMembers lists who is in a text channel, for anyone in its
// space: who is in a channel is no more private than what is said in it.
func (s *Service) ListChannelMembers(ctx context.Context, req *connect.Request[chatv1.ListChannelMembersRequest]) (*connect.Response[chatv1.ListChannelMembersResponse], error) {
	channel, err := s.accessChannel(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	if !hasMembers(channel) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errJoinNeedsText)
	}
	rows, err := s.q.ListChannelMembers(ctx, channel.ID)
	if err != nil {
		return nil, fmt.Errorf("list channel members: %w", err)
	}
	members, err := s.toProtoMembers(ctx, rows)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.ListChannelMembersResponse{Members: members}), nil
}

// AddChannelMembers puts people and bots already in the space into a text
// channel. Anyone named who is not in the space is passed over, as is
// anyone already in the channel.
func (s *Service) AddChannelMembers(ctx context.Context, req *connect.Request[chatv1.AddChannelMembersRequest]) (*connect.Response[chatv1.AddChannelMembersResponse], error) {
	channel, err := s.spaceChannelToManage(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	if !hasMembers(channel) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errJoinNeedsText)
	}
	adder := authctx.UserID(ctx)
	var added []string
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		var err error
		added, err = addMembers(ctx, qtx, channel, req.Msg.UserIds, &adder, channel.LastMessageID)
		return err
	})
	if db.HasCode(err, db.InvalidTextRepresentation) {
		return nil, apierr.Field(connect.CodeInvalidArgument, "user_ids", errors.New("not a user id"))
	}
	if err != nil {
		return nil, fmt.Errorf("add channel members: %w", err)
	}
	s.publishChannelJoined(channel, added)
	return connect.NewResponse(&chatv1.AddChannelMembersResponse{AddedUserIds: added}), nil
}

// addMembers puts people in a channel and moves the read marker of those
// it added to readUpTo, when there is one. It returns who was added.
func addMembers(ctx context.Context, qtx *dbgen.Queries, channel dbgen.Channel, userIDs []string, addedBy, readUpTo *string) ([]string, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	added, err := qtx.AddChannelMembers(ctx, dbgen.AddChannelMembersParams{
		ChannelID: channel.ID, UserIds: userIDs, AddedBy: addedBy,
	})
	if err != nil {
		return nil, err
	}
	return added, markReadFor(ctx, qtx, channel.ID, added, readUpTo)
}

// addEveryone puts every member of the space in a channel that has just
// become required, read up to its newest message.
func addEveryone(ctx context.Context, qtx *dbgen.Queries, channel dbgen.Channel, addedBy string) error {
	added, err := qtx.AddEveryoneToChannel(ctx, dbgen.AddEveryoneToChannelParams{ChannelID: channel.ID, AddedBy: &addedBy})
	if err != nil {
		return fmt.Errorf("add everyone: %w", err)
	}
	return markReadFor(ctx, qtx, channel.ID, added, channel.LastMessageID)
}

func markReadFor(ctx context.Context, qtx *dbgen.Queries, channelID string, userIDs []string, readUpTo *string) error {
	if len(userIDs) == 0 || readUpTo == nil {
		return nil
	}
	if err := qtx.MarkChannelReadFor(ctx, dbgen.MarkChannelReadForParams{
		ChannelID: channelID, LastReadMessageID: *readUpTo, UserIds: userIDs,
	}); err != nil {
		return fmt.Errorf("mark read: %w", err)
	}
	return nil
}

// publishChannelJoined tells the space who is newly in a channel.
func (s *Service) publishChannelJoined(channel dbgen.Channel, userIDs []string) {
	for _, userID := range userIDs {
		s.bus.Publish(events.SpaceTopic(spaceOf(channel)), events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_ChannelMemberJoined{
				ChannelMemberJoined: &realtimev1.ChannelMemberJoined{SpaceId: spaceOf(channel), ChannelId: channel.ID, UserId: userID},
			},
		}))
	}
}

// refuseDefaultChannel refuses with reason when the channel is its
// space's default, naming field when the refusal belongs to one.
func (s *Service) refuseDefaultChannel(ctx context.Context, channel dbgen.Channel, field string, reason error) error {
	space, err := s.q.GetSpace(ctx, spaceOf(channel))
	if err != nil {
		return apierr.NotFoundOr(err, "space")
	}
	if space.DefaultChannelID == nil || *space.DefaultChannelID != channel.ID {
		return nil
	}
	return apierr.Field(connect.CodeFailedPrecondition, field, reason)
}
