package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

// maxChannelMembersPerCall bounds one AddChannelMembers request.
const maxChannelMembersPerCall = 100

var errNotPrivate = connect.NewError(connect.CodeFailedPrecondition,
	errors.New("everyone in the space is in a public channel"))

// requireCanStartPrivate refuses a private channel the caller could not
// be the first member of.
func (s *Service) requireCanStartPrivate(ctx context.Context, spaceID string) error {
	member, err := s.q.IsSpaceMember(ctx, dbgen.IsSpaceMemberParams{SpaceID: spaceID, UserID: authctx.UserID(ctx)})
	if err != nil {
		return fmt.Errorf("check membership: %w", err)
	}
	if !member {
		return connect.NewError(connect.CodeFailedPrecondition,
			errors.New("join the space before making a private channel in it"))
	}
	return nil
}

// allChannels is every channel in a space as Space settings lists them:
// private ones included, voice channels left out while voice is off.
func (s *Service) allChannels(ctx context.Context, spaceID, userID string) ([]dbgen.ListAllChannelsBySpaceRow, error) {
	rows, err := s.q.ListAllChannelsBySpace(ctx, dbgen.ListAllChannelsBySpaceParams{SpaceID: spaceID, UserID: userID})
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

func (s *Service) ListAllChannels(ctx context.Context, req *connect.Request[chatv1.ListAllChannelsRequest]) (*connect.Response[chatv1.ListAllChannelsResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, authctx.ChannelsManage); err != nil {
		return nil, err
	}
	rows, err := s.allChannels(ctx, req.Msg.SpaceId, authctx.UserID(ctx))
	if err != nil {
		return nil, err
	}
	channels := make([]*chatv1.ManagedChannel, len(rows))
	for index, row := range rows {
		channels[index] = &chatv1.ManagedChannel{
			Channel: toProtoChannel(row.Channel), MemberCount: row.MemberCount, Joined: row.Joined,
		}
	}
	return connect.NewResponse(&chatv1.ListAllChannelsResponse{Channels: channels}), nil
}

// ListChannelMembers answers someone in the private channel, or someone
// who manages the space's channels. Anyone else is told it is not found.
func (s *Service) ListChannelMembers(ctx context.Context, req *connect.Request[chatv1.ListChannelMembersRequest]) (*connect.Response[chatv1.ListChannelMembersResponse], error) {
	channel, err := s.q.GetChannel(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, apierr.NotFoundOr(err, "channel")
	}
	if isDM(channel) {
		return nil, errChannelNotFound()
	}
	if s.requireChannelMember(ctx, channel.ID) != nil &&
		s.requirePermission(ctx, *channel.SpaceID, authctx.ChannelsManage) != nil {
		return nil, errChannelNotFound()
	}
	if !channel.Private {
		return nil, errNotPrivate
	}
	ids, err := s.q.ListPrivateChannelMemberIDs(ctx, channel.ID)
	if err != nil {
		return nil, fmt.Errorf("list channel members: %w", err)
	}
	return connect.NewResponse(&chatv1.ListChannelMembersResponse{UserIds: ids}), nil
}

// privateChannelToManage loads a private channel the caller may add
// people to and remove them from.
func (s *Service) privateChannelToManage(ctx context.Context, channelID string) (dbgen.Channel, error) {
	channel, err := s.spaceChannelToManage(ctx, channelID)
	if err != nil {
		return dbgen.Channel{}, err
	}
	if !channel.Private {
		return dbgen.Channel{}, errNotPrivate
	}
	return channel, nil
}

func (s *Service) AddChannelMembers(ctx context.Context, req *connect.Request[chatv1.AddChannelMembersRequest]) (*connect.Response[chatv1.AddChannelMembersResponse], error) {
	channel, err := s.privateChannelToManage(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	if len(req.Msg.UserIds) == 0 || len(req.Msg.UserIds) > maxChannelMembersPerCall {
		return nil, apierr.Field(connect.CodeInvalidArgument, "user_ids",
			fmt.Errorf("name between 1 and %d people", maxChannelMembersPerCall))
	}
	for _, userID := range req.Msg.UserIds {
		member, err := s.q.IsSpaceMember(ctx, dbgen.IsSpaceMemberParams{SpaceID: *channel.SpaceID, UserID: userID})
		if err != nil {
			return nil, fmt.Errorf("check membership: %w", err)
		}
		if !member {
			return nil, apierr.Field(connect.CodeFailedPrecondition, "user_ids",
				errors.New("only members of the space can be added"))
		}
	}
	if _, err := s.addMembers(ctx, channel, req.Msg.UserIds, authctx.UserID(ctx)); err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.AddChannelMembersResponse{}), nil
}

// addMembers puts space members into a private channel for actorID and
// records one "added" system message naming the people it put in: anyone
// already in is left out, and nobody new records nothing. All of them or
// none, in one transaction under the channel row (seq.go), and nobody is
// told until it commits. Each new member is sent the channel before the
// row, so their client has it when the row arrives. It returns who it put
// in.
func (s *Service) addMembers(ctx context.Context, channel dbgen.Channel, userIDs []string, actorID string) ([]string, error) {
	var (
		added    []string
		recorded string
	)
	err := s.inTx(ctx, func(qtx *dbgen.Queries) error {
		added, recorded = added[:0], ""
		// FOR NO KEY UPDATE, as a removal takes it: it shuts out every
		// other writer of the channel, and the add has no need to hold up
		// a foreign-key check (an alert, a read marker) meanwhile.
		if _, err := qtx.LockChannelNoKey(ctx, channel.ID); err != nil {
			return apierr.NotFoundOr(err, "channel")
		}
		for _, userID := range userIDs {
			inserted, err := insertChannelMember(ctx, qtx, channel, userID, actorID)
			if err != nil {
				return err
			}
			if inserted {
				added = append(added, userID)
			}
		}
		if len(added) == 0 {
			return nil
		}
		row, err := recordEvent(ctx, qtx, channel, actorID, membersAdded{UserIDs: added})
		recorded = row.ID
		return err
	})
	if err != nil {
		return nil, err
	}
	for _, userID := range added {
		s.announceJoined(ctx, channel, userID)
	}
	if event := s.systemMessageEvent(ctx, channel, recorded); event != nil {
		s.publishChannel(ctx, channel, event)
	}
	return added, nil
}

// addToChannel puts one space member into a private channel for addedBy,
// as addMembers does, and reports whether this call is what put them in.
// Already in is fine: it tells nobody and records nothing.
func (s *Service) addToChannel(ctx context.Context, channel dbgen.Channel, userID, addedBy string) (bool, error) {
	added, err := s.addMembers(ctx, channel, []string{userID}, addedBy)
	return len(added) > 0, err
}

// systemMessageEvent is MessageCreated for the system message id just
// recorded in channel, as every reader is sent it. nil when there is
// none, or when it cannot be read back: the action stands, and clients
// find the row through the channel log.
func (s *Service) systemMessageEvent(ctx context.Context, channel dbgen.Channel, id string) *realtimev1.ServerEvent {
	if id == "" {
		return nil
	}
	message, err := s.loadMessage(ctx, id, spaceOf(channel))
	if err != nil {
		slog.Default().Warn("could not load a system message to publish", "message_id", id, "err", err)
		return nil
	}
	return events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MessageCreated{MessageCreated: message},
	})
}

// insertChannelMember writes the row and reports whether it was new.
// Someone who left the space a moment ago is refused like anyone outside it.
func insertChannelMember(ctx context.Context, queries *dbgen.Queries, channel dbgen.Channel, userID, addedBy string) (bool, error) {
	inserted, err := queries.AddPrivateChannelMember(ctx, dbgen.AddPrivateChannelMemberParams{
		ChannelID: channel.ID, SpaceID: *channel.SpaceID, UserID: userID, AddedBy: &addedBy,
	})
	if db.HasCode(err, db.ForeignKeyViolation) {
		return false, apierr.Field(connect.CodeFailedPrecondition, "user_ids",
			errors.New("only members of the space can be added"))
	}
	if err != nil {
		return false, fmt.Errorf("add channel member: %w", err)
	}
	return inserted > 0, nil
}

// announceJoined tells someone newly in a private channel, and the people
// already in it.
func (s *Service) announceJoined(ctx context.Context, channel dbgen.Channel, userID string) {
	// The channel enters the person's list the way a new one does.
	s.bus.Publish(events.UserTopic(userID), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelCreated{ChannelCreated: toProtoChannel(channel)},
	}))
	s.publishChannel(ctx, channel, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelMemberJoined{
			ChannelMemberJoined: &realtimev1.ChannelMemberChanged{
				SpaceId: spaceOf(channel), ChannelId: channel.ID, UserId: userID,
			},
		},
	}))
}

func (s *Service) RemoveChannelMember(ctx context.Context, req *connect.Request[chatv1.RemoveChannelMemberRequest]) (*connect.Response[chatv1.RemoveChannelMemberResponse], error) {
	channel, err := s.privateChannelToManage(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	if err := s.removeFromChannel(ctx, channel, req.Msg.UserId); err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.RemoveChannelMemberResponse{}), nil
}

func (s *Service) LeaveChannel(ctx context.Context, req *connect.Request[chatv1.LeaveChannelRequest]) (*connect.Response[chatv1.LeaveChannelResponse], error) {
	channel, err := s.accessChannel(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	if !channel.Private {
		return nil, errNotPrivate
	}
	if err := s.removeFromChannel(ctx, channel, authctx.UserID(ctx)); err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.LeaveChannelResponse{}), nil
}

// removeFromChannel takes someone out of a private channel: their row,
// and their activity items for it, which keep message previews. The
// channel leaves their list the way a deleted one does. It records a
// "left" system message by them, whether they left or were removed:
// nothing stores who removed them. The departure and the row go only to
// the people who remain.
func (s *Service) removeFromChannel(ctx context.Context, channel dbgen.Channel, userID string) error {
	var (
		removed   int64
		recorded  string
		remaining []string
	)
	err := s.inTx(ctx, func(qtx *dbgen.Queries) error {
		removed, recorded, remaining = 0, "", nil
		// The channel row before the member's (seq.go): a send by the
		// same person holds it while it marks their activity read. Held
		// FOR NO KEY UPDATE: every other writer of the channel still
		// waits, but an alert being written for someone else here, which
		// may hold this person's alert, gets its foreign-key check
		// through instead of waiting on us while we wait on that alert.
		if _, err := qtx.LockChannelNoKey(ctx, channel.ID); err != nil {
			return apierr.NotFoundOr(err, "channel")
		}
		var err error
		removed, err = qtx.RemovePrivateChannelMember(ctx, dbgen.RemovePrivateChannelMemberParams{
			ChannelID: channel.ID, UserID: userID,
		})
		if err != nil || removed == 0 {
			return err
		}
		if err := qtx.DeleteActivityForChannel(ctx, dbgen.DeleteActivityForChannelParams{
			UserID: userID, ChannelID: channel.ID,
		}); err != nil {
			return err
		}
		row, err := recordEvent(ctx, qtx, channel, userID, memberLeft{})
		if err != nil {
			return err
		}
		recorded = row.ID
		remaining, err = peopleWith(ctx, qtx, channel)
		return err
	})
	if err != nil {
		return fmt.Errorf("remove channel member: %w", err)
	}
	if removed == 0 {
		return connect.NewError(connect.CodeNotFound, errors.New("that person isn't in this channel"))
	}
	s.bus.Publish(events.UserTopic(userID), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelDeleted{
			ChannelDeleted: &realtimev1.ChannelDeleted{SpaceId: spaceOf(channel), ChannelId: channel.ID},
		},
	}))
	s.publishTo(channel, remaining, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelMemberLeft{
			ChannelMemberLeft: &realtimev1.ChannelMemberChanged{
				SpaceId: spaceOf(channel), ChannelId: channel.ID, UserId: userID,
			},
		},
	}))
	if event := s.systemMessageEvent(ctx, channel, recorded); event != nil {
		s.publishTo(channel, remaining, event)
	}
	if isVoice(channel) {
		s.evictFromChannelVoice(ctx, channel.ID, userID)
	}
	return nil
}

// AddBotToChannel puts an incoming webhook's bot into the private channel
// the hook posts into, for a caller who is in that channel, and reports
// whether this call is what put it there. A public channel needs
// nothing. Exposed for the integrations module.
func (s *Service) AddBotToChannel(ctx context.Context, channelID, botUserID string) (bool, error) {
	channel, err := s.q.GetChannel(ctx, channelID)
	if err != nil {
		return false, apierr.NotFoundOr(err, "channel")
	}
	if !channel.Private {
		return false, nil
	}
	if err := s.requireInPrivate(ctx, channel); err != nil {
		return false, err
	}
	return s.addToChannel(ctx, channel, botUserID, authctx.UserID(ctx))
}

// RemoveBotFromChannel takes a bot back out of a private channel, for a
// webhook that could not be finished. Not in it is fine.
func (s *Service) RemoveBotFromChannel(ctx context.Context, channelID, botUserID string) error {
	channel, err := s.q.GetChannel(ctx, channelID)
	if err != nil {
		return apierr.NotFoundOr(err, "channel")
	}
	if err := s.removeFromChannel(ctx, channel, botUserID); connect.CodeOf(err) != connect.CodeNotFound {
		return err
	}
	return nil
}
