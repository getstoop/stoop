package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/accesswire"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

func (s *Service) GetMember(ctx context.Context, req *connect.Request[chatv1.GetMemberRequest]) (*connect.Response[chatv1.GetMemberResponse], error) {
	if err := s.requireSpaceMember(ctx, req.Msg.SpaceId); err != nil {
		return nil, err
	}
	row, err := s.q.GetSpaceMember(ctx, dbgen.GetSpaceMemberParams{
		SpaceID: req.Msg.SpaceId, UserID: req.Msg.UserId,
	})
	if err != nil {
		return nil, apierr.NotFoundOr(err, "member")
	}
	members, err := s.toProtoMembers(ctx, []dbgen.SpaceMember{row})
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.GetMemberResponse{Member: members[0]}), nil
}

func (s *Service) ListMembers(ctx context.Context, req *connect.Request[chatv1.ListMembersRequest]) (*connect.Response[chatv1.ListMembersResponse], error) {
	if err := s.requireSpaceMember(ctx, req.Msg.SpaceId); err != nil {
		return nil, err
	}
	rows, err := s.q.ListSpaceMembers(ctx, req.Msg.SpaceId)
	if err != nil {
		return nil, fmt.Errorf("list members: %w", err)
	}
	members, err := s.toProtoMembers(ctx, rows)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.ListMembersResponse{Members: members}), nil
}

func (s *Service) SetMemberRole(ctx context.Context, req *connect.Request[chatv1.SetMemberRoleRequest]) (*connect.Response[chatv1.SetMemberRoleResponse], error) {
	if err := s.requirePermission(ctx, req.Msg.SpaceId, authctx.MembersManage); err != nil {
		return nil, err
	}
	actor, target, err := s.actorAndTarget(ctx, req.Msg.SpaceId, req.Msg.UserId)
	if err != nil {
		return nil, err
	}
	newRole := roleFromProto(req.Msg.Role)
	if req.Msg.Role == chatv1.SpaceRole_SPACE_ROLE_UNSPECIFIED {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("role is required"))
	}
	if newRole == RoleOwner {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("ownership can't be set as a role; transfer it instead"))
	}
	if err := grantableRole(actor, newRole); err != nil {
		return nil, err
	}
	if _, err := s.q.SetSpaceMemberRole(ctx, dbgen.SetSpaceMemberRoleParams{
		SpaceID: req.Msg.SpaceId, UserID: req.Msg.UserId, Role: string(newRole),
	}); err != nil {
		return nil, fmt.Errorf("set role: %w", err)
	}
	target.Role = string(newRole)
	s.publishRoleChanged(req.Msg.SpaceId, req.Msg.UserId, newRole)

	members, err := s.toProtoMembers(ctx, []dbgen.SpaceMember{target})
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&chatv1.SetMemberRoleResponse{Member: members[0]}), nil
}

// AddMember puts an existing account into the space without an invite.
// Same permission as kicking (members.manage: space admins, the owner,
// instance admins); bans are honoured; already-in is reported, not
// silently ignored, so the admin page can say so.
func (s *Service) AddMember(ctx context.Context, req *connect.Request[chatv1.AddMemberRequest]) (*connect.Response[chatv1.AddMemberResponse], error) {
	if req.Msg.UserId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_id is required"))
	}
	if err := s.requirePermission(ctx, req.Msg.SpaceId, authctx.MembersManage); err != nil {
		return nil, err
	}
	space, err := s.q.GetSpace(ctx, req.Msg.SpaceId)
	if err != nil {
		return nil, apierr.NotFoundOr(err, "space")
	}
	if user, found, err := s.lookupUser(ctx, req.Msg.UserId); err != nil {
		return nil, fmt.Errorf("look up user: %w", err)
	} else if found && user.Kind == authctx.KindBot {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("a bot's spaces are set from Server admin → Integrations"))
	}
	if err := s.refuseIfBanned(ctx, space.ID, req.Msg.UserId); err != nil {
		return nil, err
	}
	isMember, err := s.q.IsSpaceMember(ctx, dbgen.IsSpaceMemberParams{SpaceID: space.ID, UserID: req.Msg.UserId})
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if isMember {
		return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("they're already a member of that space"))
	}
	if err := s.q.CreateSpaceMember(ctx, dbgen.CreateSpaceMemberParams{
		SpaceID: space.ID, UserID: req.Msg.UserId, Role: string(RoleMember),
	}); err != nil {
		if db.HasCode(err, db.ForeignKeyViolation) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		return nil, fmt.Errorf("add member: %w", err)
	}
	// The space as the added person sees it.
	added := memberActor(RoleMember, s.isInstanceAdmin(ctx, req.Msg.UserId))
	s.publishSpaceJoined(req.Msg.UserId, space, added)
	return connect.NewResponse(&chatv1.AddMemberResponse{Space: toProtoSpace(space, added, authctx.Credential{})}), nil
}

func (s *Service) KickMember(ctx context.Context, req *connect.Request[chatv1.KickMemberRequest]) (*connect.Response[chatv1.KickMemberResponse], error) {
	if req.Msg.UserId == authctx.UserID(ctx) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("use LeaveSpace to remove yourself"))
	}
	if err := s.requirePermission(ctx, req.Msg.SpaceId, authctx.MembersManage); err != nil {
		return nil, err
	}
	if _, _, err := s.actorAndTarget(ctx, req.Msg.SpaceId, req.Msg.UserId); err != nil {
		return nil, err
	}
	if err := s.removeFromSpace(ctx, req.Msg.SpaceId, req.Msg.UserId, true); err != nil {
		return nil, fmt.Errorf("kick member: %w", err)
	}
	return connect.NewResponse(&chatv1.KickMemberResponse{}), nil
}

func (s *Service) LeaveSpace(ctx context.Context, req *connect.Request[chatv1.LeaveSpaceRequest]) (*connect.Response[chatv1.LeaveSpaceResponse], error) {
	if id, _ := authctx.From(ctx); !id.Credential.Reaches(req.Msg.SpaceId, "") {
		return nil, connect.NewError(connect.CodePermissionDenied, authctx.ErrOutOfBounds)
	}
	if err := refuseBot(ctx, "a bot's spaces are set from Server admin → Integrations"); err != nil {
		return nil, err
	}
	// Leaving is a decision, not a preference: a token never makes it.
	switch id, _ := authctx.From(ctx); id.Credential.Kind {
	case authctx.CredentialPersonalToken, authctx.CredentialBotToken, authctx.CredentialIncomingHook:
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("leaving a space needs the app, not a token"))
	}
	userID := authctx.UserID(ctx)
	role, err := s.q.GetSpaceMemberRole(ctx, dbgen.GetSpaceMemberRoleParams{SpaceID: req.Msg.SpaceId, UserID: userID})
	if err != nil {
		return nil, apierr.NotFoundOr(err, "membership")
	}
	if Role(role) == RoleOwner {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("the owner can't leave; transfer ownership first"))
	}
	if err := s.removeFromSpace(ctx, req.Msg.SpaceId, userID, false); err != nil {
		return nil, fmt.Errorf("leave space: %w", err)
	}
	return connect.NewResponse(&chatv1.LeaveSpaceResponse{}), nil
}

// removeFromSpace removes a member, tells the space, and drops them from
// its voice channels. Leaving, a kick, a ban and a bot's removal all
// come through here.
func (s *Service) removeFromSpace(ctx context.Context, spaceID, userID string, kicked bool) error {
	left, err := s.removeMember(ctx, spaceID, userID)
	if err != nil {
		return err
	}
	s.announceLeftChannels(ctx, userID, left)
	s.publishMemberRemoved(spaceID, userID, kicked)
	s.evictFromSpaceVoice(ctx, spaceID, userID)
	return nil
}

// leftChannel is a private channel someone was in when they stopped
// being a member of its space: the "left" row recorded there, and the
// people who remain, to publish it to once the removal has committed.
type leftChannel struct {
	channel   dbgen.Channel
	messageID string
	remaining []string
}

// removeMember drops a membership, the same user's mute for the space
// and their alerts from its private channels together: a rejoin starts
// unmuted. Channel mutes are left alone, as
// they always have been; they go when the channel does.
//
// Each private channel of the space the person was in records "left"
// in the same transaction (docs/architecture/messaging.md → System
// messages), whatever the cause; the caller publishes the rows it
// returns with announceLeftChannels once it has committed.
func (s *Service) removeMember(ctx context.Context, spaceID, userID string) ([]leftChannel, error) {
	var left []leftChannel
	err := s.inTx(ctx, func(qtx *dbgen.Queries) error {
		left = nil
		// Before anything else, as seq.go requires, and before the
		// membership goes: its cascade takes the person's channel_members
		// rows with it, and with them the list of channels to record in.
		channels, err := lockPrivateChannelsOf(ctx, qtx, spaceID, userID)
		if err != nil {
			return err
		}
		// Their alerts from the space's private channels go too: each
		// shows the message as it now reads, and they can't read it.
		if err := qtx.DeleteActivityForPrivateChannels(ctx, dbgen.DeleteActivityForPrivateChannelsParams{
			UserID: userID, SpaceID: spaceID,
		}); err != nil {
			return fmt.Errorf("drop private channel activity: %w", err)
		}
		removed, err := qtx.DeleteSpaceMember(ctx, dbgen.DeleteSpaceMemberParams{
			SpaceID: spaceID, UserID: userID,
		})
		if err != nil {
			return fmt.Errorf("delete member: %w", err)
		}
		if err := qtx.UnmuteSpace(ctx, dbgen.UnmuteSpaceParams{UserID: userID, SpaceID: spaceID}); err != nil {
			return fmt.Errorf("drop space mute: %w", err)
		}
		if removed == 0 {
			return nil
		}
		for _, channel := range channels {
			row, err := recordEvent(ctx, qtx, channel, userID, memberLeft{})
			if err != nil {
				return err
			}
			remaining, err := qtx.ListPrivateChannelMemberIDs(ctx, channel.ID)
			if err != nil {
				return fmt.Errorf("list channel people: %w", err)
			}
			left = append(left, leftChannel{channel: channel, messageID: row.ID, remaining: remaining})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return left, nil
}

// lockPrivateChannelsOf holds the rows of the space's private channels
// userID is in, in id order, and returns them as they stand once held.
// Two removals that share channels take them in the same order, so
// neither waits on the other in a circle; the retention sweep sorts its
// channels for the same reason. The list is read again under the locks:
// a channel deleted meanwhile, or one the person was taken out of
// meanwhile (which recorded its own row), drops out.
func lockPrivateChannelsOf(ctx context.Context, qtx *dbgen.Queries, spaceID, userID string) ([]dbgen.Channel, error) {
	of := dbgen.ListPrivateChannelsOfMemberParams{UserID: userID, SpaceID: spaceID}
	listed, err := qtx.ListPrivateChannelsOfMember(ctx, of)
	if err != nil {
		return nil, fmt.Errorf("list private channels: %w", err)
	}
	if len(listed) == 0 {
		return nil, nil
	}
	held := make(map[string]bool, len(listed))
	for _, channel := range listed {
		if _, err := qtx.LockChannel(ctx, channel.ID); errors.Is(err, pgx.ErrNoRows) {
			continue
		} else if err != nil {
			return nil, fmt.Errorf("lock channel: %w", err)
		}
		held[channel.ID] = true
	}
	current, err := qtx.ListPrivateChannelsOfMember(ctx, of)
	if err != nil {
		return nil, fmt.Errorf("list private channels: %w", err)
	}
	channels := current[:0]
	for _, channel := range current {
		if held[channel.ID] {
			channels = append(channels, channel)
		}
	}
	return channels, nil
}

// announceLeftChannels publishes each "left" row to the people who
// remain in its channel, with the channel_member_left a removal from the
// one channel sends, so their people list and member count follow. The
// person who left is sent neither: the space's member_removed is how it
// leaves their list.
func (s *Service) announceLeftChannels(ctx context.Context, userID string, left []leftChannel) {
	for _, entry := range left {
		if message, err := s.loadMessage(ctx, entry.messageID, spaceOf(entry.channel)); err != nil {
			slog.Default().Warn("leave space: could not load its system message", "message_id", entry.messageID, "err", err)
		} else {
			s.publishTo(entry.channel, entry.remaining, events.Stamp(&realtimev1.ServerEvent{
				Payload: &realtimev1.ServerEvent_MessageCreated{MessageCreated: message},
			}))
		}
		s.publishTo(entry.channel, entry.remaining, events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_ChannelMemberLeft{
				ChannelMemberLeft: &realtimev1.ChannelMemberChanged{
					SpaceId: spaceOf(entry.channel), ChannelId: entry.channel.ID, UserId: userID,
				},
			},
		}))
	}
}

// actorAndTarget loads both sides of a member-management call and applies
// the hierarchy rule.
func (s *Service) actorAndTarget(ctx context.Context, spaceID, targetID string) (actor, dbgen.SpaceMember, error) {
	a, err := s.actorFor(ctx, spaceID)
	if err != nil {
		return a, dbgen.SpaceMember{}, err
	}
	target, err := s.q.GetSpaceMember(ctx, dbgen.GetSpaceMemberParams{SpaceID: spaceID, UserID: targetID})
	if err != nil {
		return a, target, apierr.NotFoundOr(err, "member")
	}
	if !canActOn(a, Role(target.Role)) {
		return a, target, connect.NewError(connect.CodePermissionDenied,
			fmt.Errorf("you can't change or remove the space's %s", target.Role))
	}
	return a, target, nil
}

func (s *Service) publishRoleChanged(spaceID, userID string, role Role) {
	s.bus.Publish(events.SpaceTopic(spaceID), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MemberRoleChanged{
			MemberRoleChanged: &realtimev1.MemberRoleChanged{
				SpaceId: spaceID, UserId: userID, Role: toProtoRole(role),
			},
		},
	}))
}

// publishMemberRemoved goes to the space topic: the removed user's own
// connections are still subscribed at this instant, and the gateway drops
// the subscription when it sees its user in the event.
func (s *Service) publishMemberRemoved(spaceID, userID string, kicked bool) {
	s.bus.Publish(events.SpaceTopic(spaceID), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MemberRemoved{
			MemberRemoved: &realtimev1.MemberRemoved{SpaceId: spaceID, UserId: userID, Kicked: kicked},
		},
	}))
}

// AnnounceRename is auth's port for a username change: each of the
// person's spaces and their own devices refetch them and the messages
// that mention them.
func (s *Service) AnnounceRename(ctx context.Context, userID string) {
	spaceIDs, err := s.q.ListSpaceIDsByUser(ctx, userID)
	if err != nil {
		slog.Default().Warn("rename: spaces not notified", "user_id", userID, "err", err)
	}
	for _, spaceID := range spaceIDs {
		s.publishMemberUpdated(events.SpaceTopic(spaceID), spaceID, userID)
	}
	s.publishMemberUpdated(events.UserTopic(userID), "", userID)
}

func (s *Service) publishMemberUpdated(topic, spaceID, userID string) {
	s.bus.Publish(topic, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MemberUpdated{
			MemberUpdated: &realtimev1.MemberUpdated{SpaceId: spaceID, UserId: userID},
		},
	}))
}

// toProtoMembers resolves identities through the directory port in one call.
func (s *Service) toProtoMembers(ctx context.Context, rows []dbgen.SpaceMember) ([]*chatv1.Member, error) {
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.UserID
	}
	users, err := s.usersByID(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("resolve members: %w", err)
	}
	out := make([]*chatv1.Member, len(rows))
	for i, member := range rows {
		out[i] = toProtoMember(member, users[member.UserID])
	}
	return out, nil
}

func toProtoMember(m dbgen.SpaceMember, u UserRecord) *chatv1.Member {
	username := u.Username
	if username == "" {
		username = "unknown"
	}
	return &chatv1.Member{
		UserId: m.UserID, Username: username, DisplayName: u.DisplayName,
		Role: toProtoRole(Role(m.Role)), JoinedAt: timestamppb.New(m.JoinedAt),
		InstanceAdmin: u.InstanceAdmin, AvatarFileId: u.AvatarFileID,
		Kind: accesswire.KindToProto(u.Kind),
	}
}
