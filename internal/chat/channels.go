package chat

import (
	"context"
	"errors"
	"fmt"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/Jhut89/stoop/internal/authctx"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/Jhut89/stoop/gen/stoop/realtime/v1"
	"github.com/Jhut89/stoop/internal/dbgen"
	"github.com/Jhut89/stoop/internal/events"
)

func (s *Service) CreateChannel(ctx context.Context, req *connect.Request[chatv1.CreateChannelRequest]) (*connect.Response[chatv1.CreateChannelResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, PermManageChannels); err != nil {
		return nil, err
	}
	name := req.Msg.Name
	if name == "" || utf8.RuneCountInString(name) > 100 {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("channel name must be 1-100 characters"))
	}
	kind := req.Msg.Kind
	if kind == chatv1.ChannelKind_CHANNEL_KIND_UNSPECIFIED {
		kind = chatv1.ChannelKind_CHANNEL_KIND_TEXT
	}

	if kind == chatv1.ChannelKind_CHANNEL_KIND_DM {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("direct messages are opened with OpenDirectMessage"))
	}
	channel, err := s.q.CreateChannel(ctx, dbgen.CreateChannelParams{
		ID: newID(), SpaceID: req.Msg.SpaceId, Name: name, Kind: int16(kind),
	})
	if err != nil {
		return nil, fmt.Errorf("create channel: %w", err)
	}

	s.bus.Publish("space:"+req.Msg.SpaceId, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelCreated{
			ChannelCreated: toProtoChannel(channel),
		},
	}))

	return connect.NewResponse(&chatv1.CreateChannelResponse{Channel: toProtoChannel(channel)}), nil
}

func (s *Service) ListChannels(ctx context.Context, req *connect.Request[chatv1.ListChannelsRequest]) (*connect.Response[chatv1.ListChannelsResponse], error) {
	if err := s.requireSpaceMember(ctx, req.Msg.SpaceId); err != nil {
		return nil, err
	}
	rows, err := s.q.ListChannelsBySpace(ctx, dbgen.ListChannelsBySpaceParams{
		SpaceID: req.Msg.SpaceId, UserID: authctx.UserID(ctx),
	})
	if err != nil {
		return nil, fmt.Errorf("list channels: %w", err)
	}
	channels := make([]*chatv1.Channel, len(rows))
	for i, r := range rows {
		channels[i] = toProtoChannel(r.Channel)
		if r.LastReadMessageID != nil {
			channels[i].LastReadMessageId = *r.LastReadMessageID
		}
		channels[i].UnreadCount = int32(r.UnreadCount)
		channels[i].Muted = r.Muted
	}
	return connect.NewResponse(&chatv1.ListChannelsResponse{Channels: channels}), nil
}

// VoiceChannelSpace implements realtime.ChannelLookup: the space of a
// voice channel, or "" for unknown and text channels.
func (s *Service) VoiceChannelSpace(ctx context.Context, channelID string) (string, error) {
	channel, err := s.q.GetChannel(ctx, channelID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get channel: %w", err)
	}
	if chatv1.ChannelKind(channel.Kind) != chatv1.ChannelKind_CHANNEL_KIND_VOICE {
		return "", nil
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
	if req.Msg.Name != nil {
		if n := *req.Msg.Name; n == "" || utf8.RuneCountInString(n) > 100 {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				errors.New("channel name must be 1-100 characters"))
		}
	}
	// An empty topic clears it; an absent one leaves it alone.
	var topic *string
	if req.Msg.Topic != nil {
		t := oneLine(*req.Msg.Topic)
		if utf8.RuneCountInString(t) > maxChannelTopic {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("topic must be %d characters or fewer", maxChannelTopic))
		}
		topic = &t
	}
	row, err := s.q.UpdateChannel(ctx, dbgen.UpdateChannelParams{
		ID: channel.ID, Name: req.Msg.Name, Topic: topic,
	})
	if err != nil {
		return nil, fmt.Errorf("update channel: %w", err)
	}
	out := toProtoChannel(row)
	s.bus.Publish("space:"+spaceOf(channel), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelUpdated{ChannelUpdated: out},
	}))
	return connect.NewResponse(&chatv1.UpdateChannelResponse{Channel: out}), nil
}

func (s *Service) DeleteChannel(ctx context.Context, req *connect.Request[chatv1.DeleteChannelRequest]) (*connect.Response[chatv1.DeleteChannelResponse], error) {
	channel, err := s.spaceChannelToManage(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	n, err := s.q.CountChannelsInSpace(ctx, spaceOf(channel))
	if err != nil {
		return nil, fmt.Errorf("count channels: %w", err)
	}
	if n <= 1 {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("a space needs at least one channel"))
	}
	// Clearing the landing channel and deleting it belong in one
	// transaction. Reading the space first and comparing afterwards would
	// leave a window in which another admin moves the default: we would
	// either miss a clear that happened or announce one that did not. The
	// conditional UPDATE decides and reports in a single statement, and
	// holds the space's row lock until the delete commits.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
	qtx := s.q.WithTx(tx)

	cleared, err := qtx.ClearSpaceDefaultChannel(ctx, dbgen.ClearSpaceDefaultChannelParams{
		ID: spaceOf(channel), ChannelID: channel.ID,
	})
	wasDefault := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("clear default channel: %w", err)
	}
	if err := qtx.DeleteChannel(ctx, channel.ID); err != nil {
		return nil, fmt.Errorf("delete channel: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	s.bus.Publish("space:"+spaceOf(channel), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelDeleted{
			ChannelDeleted: &realtimev1.ChannelDeleted{SpaceId: spaceOf(channel), ChannelId: channel.ID},
		},
	}))
	if chatv1.ChannelKind(channel.Kind) == chatv1.ChannelKind_CHANNEL_KIND_VOICE {
		s.closeVoiceRooms(ctx, channel.ID)
	}
	// Only when this delete is what cleared it, and carrying the row that
	// was actually written: members whose settings page is open would
	// otherwise go on being offered a channel that is gone.
	if wasDefault {
		s.bus.Publish("space:"+cleared.ID, events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_SpaceUpdated{
				SpaceUpdated: &realtimev1.SpaceUpdated{Space: toProtoSpace(cleared, "")},
			},
		}))
	}
	return connect.NewResponse(&chatv1.DeleteChannelResponse{}), nil
}

func (s *Service) ReorderChannels(ctx context.Context, req *connect.Request[chatv1.ReorderChannelsRequest]) (*connect.Response[chatv1.ReorderChannelsResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, PermManageChannels); err != nil {
		return nil, err
	}
	rows, err := s.q.ListChannelsBySpace(ctx, dbgen.ListChannelsBySpaceParams{
		SpaceID: req.Msg.SpaceId, UserID: authctx.UserID(ctx),
	})
	if err != nil {
		return nil, fmt.Errorf("list channels: %w", err)
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

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
	qtx := s.q.WithTx(tx)
	for i, id := range req.Msg.ChannelIds {
		if err := qtx.SetChannelPosition(ctx, dbgen.SetChannelPositionParams{
			ID: id, SpaceID: req.Msg.SpaceId, Position: int32(i),
		}); err != nil {
			return nil, fmt.Errorf("set position: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	rows, err = s.q.ListChannelsBySpace(ctx, dbgen.ListChannelsBySpaceParams{
		SpaceID: req.Msg.SpaceId, UserID: authctx.UserID(ctx),
	})
	if err != nil {
		return nil, fmt.Errorf("list channels: %w", err)
	}
	channels := make([]*chatv1.Channel, len(rows))
	for i, r := range rows {
		channels[i] = toProtoChannel(r.Channel)
	}
	// Broadcast without per-caller read markers; clients keep their own.
	s.bus.Publish("space:"+req.Msg.SpaceId, events.Stamp(&realtimev1.ServerEvent{
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
	s.bus.Publish("user:"+userID, events.Stamp(&realtimev1.ServerEvent{
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
		return dbgen.Channel{}, notFoundOr(err, "channel")
	}
	if isDM(channel) {
		return dbgen.Channel{}, connect.NewError(connect.CodeInvalidArgument,
			errors.New("direct messages can't be managed"))
	}
	if err := s.requirePermission(ctx, *channel.SpaceID, PermManageChannels); err != nil {
		return dbgen.Channel{}, err
	}
	return channel, nil
}

// A topic gets the width of a channel header, where a space description
// gets a 244 px sidebar row.
const maxChannelTopic = 250

func toProtoChannel(c dbgen.Channel) *chatv1.Channel {
	out := &chatv1.Channel{
		Id: c.ID, SpaceId: spaceOf(c), Name: c.Name,
		Kind: chatv1.ChannelKind(c.Kind), Position: c.Position,
		CreatedAt: timestamppb.New(c.CreatedAt), Topic: c.Topic,
	}
	if c.LastMessageID != nil {
		out.LastMessageId = *c.LastMessageID
	}
	return out
}
