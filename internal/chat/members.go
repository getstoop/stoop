package chat

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgconn"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/Jhut89/stoop/gen/stoop/realtime/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/dbgen"
	"github.com/Jhut89/stoop/internal/events"
)

func (s *Service) GetMember(ctx context.Context, req *connect.Request[chatv1.GetMemberRequest]) (*connect.Response[chatv1.GetMemberResponse], error) {
	if err := s.requireSpaceMember(ctx, req.Msg.SpaceId); err != nil {
		return nil, err
	}
	row, err := s.q.GetSpaceMember(ctx, dbgen.GetSpaceMemberParams{
		SpaceID: req.Msg.SpaceId, UserID: req.Msg.UserId,
	})
	if err != nil {
		return nil, notFoundOr(err, "member")
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
	if err := s.requirePermission(ctx, req.Msg.SpaceId, PermManageMembers); err != nil {
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
// Same permission as kicking (manage_members: space admins, the owner,
// instance admins); bans are honoured; already-in is reported, not
// silently ignored, so the admin page can say so.
func (s *Service) AddMember(ctx context.Context, req *connect.Request[chatv1.AddMemberRequest]) (*connect.Response[chatv1.AddMemberResponse], error) {
	if req.Msg.UserId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_id is required"))
	}
	if err := s.requirePermission(ctx, req.Msg.SpaceId, PermManageMembers); err != nil {
		return nil, err
	}
	space, err := s.q.GetSpace(ctx, req.Msg.SpaceId)
	if err != nil {
		return nil, notFoundOr(err, "space")
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
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		return nil, fmt.Errorf("add member: %w", err)
	}
	s.publishSpaceJoined(req.Msg.UserId, space, RoleMember)
	return connect.NewResponse(&chatv1.AddMemberResponse{Space: toProtoSpace(space, RoleMember)}), nil
}

func (s *Service) KickMember(ctx context.Context, req *connect.Request[chatv1.KickMemberRequest]) (*connect.Response[chatv1.KickMemberResponse], error) {
	if req.Msg.UserId == authctx.UserID(ctx) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("use LeaveSpace to remove yourself"))
	}
	if err := s.requirePermission(ctx, req.Msg.SpaceId, PermManageMembers); err != nil {
		return nil, err
	}
	if _, _, err := s.actorAndTarget(ctx, req.Msg.SpaceId, req.Msg.UserId); err != nil {
		return nil, err
	}
	if err := s.removeMember(ctx, req.Msg.SpaceId, req.Msg.UserId); err != nil {
		return nil, fmt.Errorf("kick member: %w", err)
	}
	s.publishMemberRemoved(req.Msg.SpaceId, req.Msg.UserId, true)
	s.evictFromSpaceVoice(ctx, req.Msg.SpaceId, req.Msg.UserId)
	return connect.NewResponse(&chatv1.KickMemberResponse{}), nil
}

func (s *Service) LeaveSpace(ctx context.Context, req *connect.Request[chatv1.LeaveSpaceRequest]) (*connect.Response[chatv1.LeaveSpaceResponse], error) {
	userID := authctx.UserID(ctx)
	role, err := s.q.GetSpaceMemberRole(ctx, dbgen.GetSpaceMemberRoleParams{SpaceID: req.Msg.SpaceId, UserID: userID})
	if err != nil {
		return nil, notFoundOr(err, "membership")
	}
	if Role(role) == RoleOwner {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("the owner can't leave; transfer ownership first"))
	}
	if err := s.removeMember(ctx, req.Msg.SpaceId, userID); err != nil {
		return nil, fmt.Errorf("leave space: %w", err)
	}
	s.publishMemberRemoved(req.Msg.SpaceId, userID, false)
	s.evictFromSpaceVoice(ctx, req.Msg.SpaceId, userID)
	return connect.NewResponse(&chatv1.LeaveSpaceResponse{}), nil
}

// removeMember drops a membership and the same user's mute for the space
// together: a rejoin starts unmuted. Channel mutes are left alone, as
// they always have been; they go when the channel does.
func (s *Service) removeMember(ctx context.Context, spaceID, userID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
	qtx := s.q.WithTx(tx)
	if _, err := qtx.DeleteSpaceMember(ctx, dbgen.DeleteSpaceMemberParams{
		SpaceID: spaceID, UserID: userID,
	}); err != nil {
		return fmt.Errorf("delete member: %w", err)
	}
	if err := qtx.UnmuteSpace(ctx, dbgen.UnmuteSpaceParams{UserID: userID, SpaceID: spaceID}); err != nil {
		return fmt.Errorf("drop space mute: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
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
		return a, target, notFoundOr(err, "member")
	}
	if !canActOn(a, Role(target.Role)) {
		return a, target, connect.NewError(connect.CodePermissionDenied,
			fmt.Errorf("you can't change or remove the space's %s", target.Role))
	}
	return a, target, nil
}

func (s *Service) publishRoleChanged(spaceID, userID string, role Role) {
	s.bus.Publish("space:"+spaceID, events.Stamp(&realtimev1.ServerEvent{
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
	s.bus.Publish("space:"+spaceID, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MemberRemoved{
			MemberRemoved: &realtimev1.MemberRemoved{SpaceId: spaceID, UserId: userID, Kicked: kicked},
		},
	}))
}

// toProtoMembers resolves identities through the directory port in one call.
func (s *Service) toProtoMembers(ctx context.Context, rows []dbgen.SpaceMember) ([]*chatv1.Member, error) {
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.UserID
	}
	records, err := s.users.GetUsers(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("resolve members: %w", err)
	}
	byID := make(map[string]UserRecord, len(records))
	for _, r := range records {
		byID[r.ID] = r
	}
	out := make([]*chatv1.Member, len(rows))
	for i, r := range rows {
		out[i] = toProtoMember(r, byID[r.UserID])
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
	}
}
