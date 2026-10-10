package chat

import (
	"context"
	"errors"
	"fmt"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/getstoop/stoop/internal/authctx"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/rowid"
	"github.com/getstoop/stoop/internal/text"
)

const maxChannelName = 32

var errChannelName = fmt.Errorf(
	"a channel name takes lowercase letters a-z, numbers, - and _, starts with a letter or number, and is at most %d characters",
	maxChannelName)

// validChannelName is the rule for a new name or a rename; see
// docs/architecture/messaging.md → Channel names.
func validChannelName(name string) bool {
	if name == "" || len(name) > maxChannelName {
		return false
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		switch {
		case c >= 'a' && c <= 'z', c >= '0' && c <= '9':
		case (c == '-' || c == '_') && i > 0:
		default:
			return false
		}
	}
	return true
}

// errChannelNameTaken answers a write refused by channels_space_name_uniq.
var errChannelNameTaken = apierr.Field(connect.CodeAlreadyExists, "name",
	errors.New("this space already has a channel with that name"))

func (s *Service) CreateChannel(ctx context.Context, req *connect.Request[chatv1.CreateChannelRequest]) (*connect.Response[chatv1.CreateChannelResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, authctx.ChannelsManage); err != nil {
		return nil, err
	}
	name := req.Msg.Name
	if !validChannelName(name) {
		return nil, apierr.Field(connect.CodeInvalidArgument, "name", errChannelName)
	}
	kind := req.Msg.Kind
	if kind == chatv1.ChannelKind_CHANNEL_KIND_UNSPECIFIED {
		kind = chatv1.ChannelKind_CHANNEL_KIND_TEXT
	}

	if kind == chatv1.ChannelKind_CHANNEL_KIND_DM {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("direct messages are opened with OpenDirectMessage"))
	}
	if kind == chatv1.ChannelKind_CHANNEL_KIND_VOICE {
		if err := s.requireVoice(ctx, req.Msg.SpaceId); err != nil {
			return nil, err
		}
	}
	text := kind == chatv1.ChannelKind_CHANNEL_KIND_TEXT
	if req.Msg.Required && !text {
		return nil, apierr.Field(connect.CodeInvalidArgument, "required", errRequiredNeedsText)
	}
	// The channel and its first people land together: the creator, and
	// everyone in the space or whoever was named.
	creator := authctx.UserID(ctx)
	var channel dbgen.Channel
	var memberCount int
	err := s.inTx(ctx, func(qtx *dbgen.Queries) error {
		var err error
		channel, err = qtx.CreateChannel(ctx, dbgen.CreateChannelParams{
			ID: rowid.New(), SpaceID: req.Msg.SpaceId, Name: name, Kind: int16(kind), Required: req.Msg.Required,
		})
		if err != nil {
			return err
		}
		if !text {
			return nil
		}
		var added []string
		if req.Msg.Required {
			added, err = qtx.AddEveryoneToChannel(ctx, dbgen.AddEveryoneToChannelParams{ChannelID: channel.ID, AddedBy: &creator})
		} else {
			added, err = qtx.AddChannelMembers(ctx, dbgen.AddChannelMembersParams{
				ChannelID: channel.ID, UserIds: append([]string{creator}, req.Msg.MemberIds...), AddedBy: &creator,
			})
		}
		memberCount = len(added)
		return err
	})
	if db.HasCode(err, db.UniqueViolation) {
		return nil, errChannelNameTaken
	}
	if db.HasCode(err, db.InvalidTextRepresentation) {
		return nil, apierr.Field(connect.CodeInvalidArgument, "member_ids", errors.New("not a user id"))
	}
	if err != nil {
		return nil, fmt.Errorf("create channel: %w", err)
	}

	s.bus.Publish(events.SpaceTopic(req.Msg.SpaceId), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelCreated{
			ChannelCreated: toProtoChannel(channel),
		},
	}))

	out := toProtoChannel(channel)
	out.Joined, out.MemberCount = true, int32(memberCount)
	return connect.NewResponse(&chatv1.CreateChannelResponse{Channel: out}), nil
}

func (s *Service) ListChannels(ctx context.Context, req *connect.Request[chatv1.ListChannelsRequest]) (*connect.Response[chatv1.ListChannelsResponse], error) {
	if err := s.requireSpaceMember(ctx, req.Msg.SpaceId); err != nil {
		return nil, err
	}
	rows, err := s.listChannels(ctx, req.Msg.SpaceId, authctx.UserID(ctx))
	if err != nil {
		return nil, err
	}
	channels := make([]*chatv1.Channel, len(rows))
	for i, r := range rows {
		channels[i] = toProtoChannel(r.Channel)
		if r.LastReadMessageID != nil {
			channels[i].LastReadMessageId = *r.LastReadMessageID
		}
		channels[i].UnreadCount = int32(r.UnreadCount)
		channels[i].Muted = r.Muted
		channels[i].Joined = r.Joined
		channels[i].MemberCount = int32(r.MemberCount)
	}
	return connect.NewResponse(&chatv1.ListChannelsResponse{Channels: channels}), nil
}

// VoiceChannelSpace implements realtime.ChannelLookup: the space of a
// voice channel, or "" for unknown and text channels, and for a voice
// channel while voice is off.
func (s *Service) VoiceChannelSpace(ctx context.Context, channelID string) (string, error) {
	channel, err := s.q.GetChannel(ctx, channelID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get channel: %w", err)
	}
	if !isVoice(channel) {
		return "", nil
	}
	if on, err := s.voiceOn(ctx, spaceOf(channel)); err != nil || !on {
		return "", err
	}
	return spaceOf(channel), nil
}

// IsVoiceChannel implements voice.ChannelDirectory. Unknown channels report
// false; callers check membership first, which already covers existence.
func (s *Service) IsVoiceChannel(ctx context.Context, channelID string) (bool, error) {
	spaceID, err := s.VoiceChannelSpace(ctx, channelID)
	return spaceID != "", err
}

func (s *Service) UpdateChannel(ctx context.Context, req *connect.Request[chatv1.UpdateChannelRequest]) (*connect.Response[chatv1.UpdateChannelResponse], error) {
	channel, err := s.spaceChannelToManage(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	// A name from before the rule stays until it is changed.
	renamed := req.Msg.Name != nil && *req.Msg.Name != channel.Name
	if renamed && !validChannelName(*req.Msg.Name) {
		return nil, apierr.Field(connect.CodeInvalidArgument, "name", errChannelName)
	}
	// An unchanged name is not written: the channel may have been renamed
	// since it was read, and only a claimed name goes in.
	name := req.Msg.Name
	if !renamed {
		name = nil
	}
	// An empty topic clears it; an absent one leaves it alone.
	var topic *string
	if req.Msg.Topic != nil {
		t := text.OneLine(*req.Msg.Topic)
		if utf8.RuneCountInString(t) > maxChannelTopic {
			return nil, apierr.Field(connect.CodeInvalidArgument, "topic",
				fmt.Errorf("topic must be %d characters or fewer", maxChannelTopic))
		}
		topic = &t
	}
	var policy *string
	if req.Msg.PostPolicy != nil {
		p, ok := postPolicies[*req.Msg.PostPolicy]
		if !ok {
			return nil, apierr.Field(connect.CodeInvalidArgument, "post_policy", errors.New("unknown post policy"))
		}
		if channel.Kind != int16(chatv1.ChannelKind_CHANNEL_KIND_TEXT) {
			return nil, apierr.Field(connect.CodeInvalidArgument, "post_policy",
				errors.New("only a text channel can be an announcement channel"))
		}
		policy = &p
	}
	requiring := req.Msg.Required != nil && *req.Msg.Required && !channel.Required
	if req.Msg.Required != nil {
		if channel.Kind != int16(chatv1.ChannelKind_CHANNEL_KIND_TEXT) {
			return nil, apierr.Field(connect.CodeInvalidArgument, "required", errRequiredNeedsText)
		}
		if !*req.Msg.Required && channel.Required {
			if err := s.refuseDefaultChannel(ctx, channel, "required", errDefaultStaysRequired); err != nil {
				return nil, err
			}
		}
	}
	// Everyone joins in the transaction that makes the channel required.
	// No event names them: ChannelUpdated says it is required, which is
	// everyone.
	var row dbgen.Channel
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		var err error
		row, err = qtx.UpdateChannel(ctx, dbgen.UpdateChannelParams{
			ID: channel.ID, Name: name, Topic: topic, PostPolicy: policy, Required: req.Msg.Required,
		})
		if err != nil || !requiring {
			return err
		}
		return addEveryone(ctx, qtx, row, authctx.UserID(ctx))
	})
	if db.HasCode(err, db.UniqueViolation) {
		return nil, errChannelNameTaken
	}
	if err != nil {
		return nil, fmt.Errorf("update channel: %w", err)
	}
	out := toProtoChannel(row)
	s.bus.Publish(events.SpaceTopic(spaceOf(channel)), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelUpdated{ChannelUpdated: out},
	}))
	return connect.NewResponse(&chatv1.UpdateChannelResponse{Channel: out}), nil
}

func (s *Service) DeleteChannel(ctx context.Context, req *connect.Request[chatv1.DeleteChannelRequest]) (*connect.Response[chatv1.DeleteChannelResponse], error) {
	channel, err := s.spaceChannelToManage(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	withVoice, err := s.voiceOn(ctx, spaceOf(channel))
	if err != nil {
		return nil, err
	}
	listed, err := s.q.CountChannelsInSpace(ctx, dbgen.CountChannelsInSpaceParams{
		SpaceID: spaceOf(channel), WithVoice: withVoice,
	})
	if err != nil {
		return nil, fmt.Errorf("count channels: %w", err)
	}
	if listed <= 1 {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("a space needs at least one channel"))
	}
	deleted, err := s.q.DeleteChannel(ctx, channel.ID)
	if err != nil {
		return nil, fmt.Errorf("delete channel: %w", err)
	}
	if deleted == 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errDefaultChannelDelete)
	}

	s.bus.Publish(events.SpaceTopic(spaceOf(channel)), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelDeleted{
			ChannelDeleted: &realtimev1.ChannelDeleted{SpaceId: spaceOf(channel), ChannelId: channel.ID},
		},
	}))
	if isVoice(channel) {
		s.closeVoiceRooms(ctx, channel.ID)
	}
	return connect.NewResponse(&chatv1.DeleteChannelResponse{}), nil
}

func (s *Service) ReorderChannels(ctx context.Context, req *connect.Request[chatv1.ReorderChannelsRequest]) (*connect.Response[chatv1.ReorderChannelsResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, authctx.ChannelsManage); err != nil {
		return nil, err
	}
	rows, err := s.listChannels(ctx, req.Msg.SpaceId, authctx.UserID(ctx))
	if err != nil {
		return nil, err
	}
	// The request must name every channel exactly once.
	existing := make(map[string]bool, len(rows))
	for _, r := range rows {
		existing[r.Channel.ID] = true
	}
	if len(req.Msg.ChannelIds) != len(rows) {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("channel_ids must list every channel in the space"))
	}
	seen := map[string]bool{}
	for _, id := range req.Msg.ChannelIds {
		if !existing[id] || seen[id] {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				errors.New("channel_ids must list every channel in the space exactly once"))
		}
		seen[id] = true
	}

	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		for index, id := range req.Msg.ChannelIds {
			if err := qtx.SetChannelPosition(ctx, dbgen.SetChannelPositionParams{
				ID: id, SpaceID: req.Msg.SpaceId, Position: int32(index),
			}); err != nil {
				return fmt.Errorf("set position: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	rows, err = s.listChannels(ctx, req.Msg.SpaceId, authctx.UserID(ctx))
	if err != nil {
		return nil, err
	}
	channels := make([]*chatv1.Channel, len(rows))
	for i, r := range rows {
		channels[i] = toProtoChannel(r.Channel)
	}
	// Broadcast without per-caller read markers; clients keep their own.
	s.bus.Publish(events.SpaceTopic(req.Msg.SpaceId), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelsReordered{
			ChannelsReordered: &realtimev1.ChannelsReordered{SpaceId: req.Msg.SpaceId, Channels: channels},
		},
	}))
	return connect.NewResponse(&chatv1.ReorderChannelsResponse{Channels: channels}), nil
}

// MarkChannelRead moves the caller's read marker to the channel's newest
// message (or to message_id). Their other connections hear about it on
// the personal topic so every device clears the unread state.
func (s *Service) MarkChannelRead(ctx context.Context, req *connect.Request[chatv1.MarkChannelReadRequest]) (*connect.Response[chatv1.MarkChannelReadResponse], error) {
	channel, err := s.accessChannel(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	target := req.Msg.MessageId
	if target == "" && channel.LastMessageID != nil {
		target = *channel.LastMessageID
	}
	if target == "" {
		return connect.NewResponse(&chatv1.MarkChannelReadResponse{}), nil // nothing to read yet
	}
	userID := authctx.UserID(ctx)
	if err := s.q.UpsertChannelRead(ctx, dbgen.UpsertChannelReadParams{
		UserID: userID, ChannelID: channel.ID, LastReadMessageID: target,
	}); err != nil {
		return nil, fmt.Errorf("mark read: %w", err)
	}
	s.bus.Publish(events.UserTopic(userID), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelRead{
			ChannelRead: &realtimev1.ChannelRead{
				SpaceId: spaceOf(channel), ChannelId: channel.ID, LastReadMessageId: target,
			},
		},
	}))
	return connect.NewResponse(&chatv1.MarkChannelReadResponse{LastReadMessageId: target}), nil
}

// spaceChannelToManage loads a channel the caller may manage. Direct
// messages have no manager: they are never renamed, moved or deleted.
func (s *Service) spaceChannelToManage(ctx context.Context, channelID string) (dbgen.Channel, error) {
	channel, err := s.q.GetChannel(ctx, channelID)
	if err != nil {
		return dbgen.Channel{}, apierr.NotFoundOr(err, "channel")
	}
	if isDM(channel) {
		return dbgen.Channel{}, connect.NewError(connect.CodeInvalidArgument,
			errors.New("direct messages can't be managed"))
	}
	if err := s.requirePermission(ctx, *channel.SpaceID, authctx.ChannelsManage); err != nil {
		return dbgen.Channel{}, err
	}
	return channel, nil
}

// A topic gets the width of a channel header, where a space description
// gets a 244 px sidebar row.
const maxChannelTopic = 250

// The channels.post_policy values; the column's check constraint holds
// the same two.
const (
	postPolicyEveryone = "everyone"
	postPolicyAdmins   = "admins"
)

var postPolicies = map[chatv1.ChannelPostPolicy]string{
	chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_EVERYONE: postPolicyEveryone,
	chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS:   postPolicyAdmins,
}

func toProtoChannel(c dbgen.Channel) *chatv1.Channel {
	out := &chatv1.Channel{
		Id: c.ID, SpaceId: spaceOf(c), Name: c.Name,
		Kind: chatv1.ChannelKind(c.Kind), Position: c.Position,
		CreatedAt: timestamppb.New(c.CreatedAt), Topic: c.Topic,
		PostPolicy: chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_EVERYONE,
		Required:   c.Required,
	}
	if c.PostPolicy == postPolicyAdmins {
		out.PostPolicy = chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS
	}
	if c.LastMessageID != nil {
		out.LastMessageId = *c.LastMessageID
	}
	return out
}
