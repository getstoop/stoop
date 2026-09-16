package instance

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/accesswire"
	"github.com/getstoop/stoop/internal/authctx"
)

func (s *Service) ListUsers(ctx context.Context, _ *connect.Request[instancev1.ListUsersRequest]) (*connect.Response[instancev1.ListUsersResponse], error) {
	if err := requireAction(ctx, authctx.InstanceRead); err != nil {
		return nil, err
	}
	users, err := s.users.ListUsers(ctx)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	out := make([]*instancev1.InstanceUser, len(users))
	for i, u := range users {
		out[i] = toProtoUser(u)
	}
	return connect.NewResponse(&instancev1.ListUsersResponse{Users: out}), nil
}

func (s *Service) SetUserRole(ctx context.Context, req *connect.Request[instancev1.SetUserRoleRequest]) (*connect.Response[instancev1.SetUserRoleResponse], error) {
	if err := requireAction(ctx, authctx.InstanceUsersManage); err != nil {
		return nil, err
	}
	if req.Msg.UserId == authctx.UserID(ctx) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("you can't change your own role"))
	}
	var role authctx.Role
	switch req.Msg.Role {
	case authv1.InstanceRole_INSTANCE_ROLE_ADMIN:
		role = authctx.RoleAdmin
	case authv1.InstanceRole_INSTANCE_ROLE_MEMBER:
		role = authctx.RoleMember
	default:
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("role must be admin or member"))
	}
	u, err := s.users.SetUserRole(ctx, req.Msg.UserId, role)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.SetUserRoleResponse{User: toProtoUser(u)}), nil
}

func (s *Service) SetUserActive(ctx context.Context, req *connect.Request[instancev1.SetUserActiveRequest]) (*connect.Response[instancev1.SetUserActiveResponse], error) {
	if err := requireAction(ctx, authctx.InstanceUsersManage); err != nil {
		return nil, err
	}
	if !req.Msg.Active {
		if req.Msg.UserId == authctx.UserID(ctx) {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("you can't deactivate yourself"))
		}
	}
	u, err := s.users.SetUserActive(ctx, req.Msg.UserId, req.Msg.Active)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.SetUserActiveResponse{User: toProtoUser(u)}), nil
}

func (s *Service) ResetUserPassword(ctx context.Context, req *connect.Request[instancev1.ResetUserPasswordRequest]) (*connect.Response[instancev1.ResetUserPasswordResponse], error) {
	if err := requireAction(ctx, authctx.InstanceUsersManage); err != nil {
		return nil, err
	}
	if req.Msg.UserId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_id is required"))
	}
	if req.Msg.UserId == authctx.UserID(ctx) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("change your own password on your profile page"))
	}
	temp, u, err := s.users.ResetUserPassword(ctx, req.Msg.UserId)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.ResetUserPasswordResponse{User: toProtoUser(u), TemporaryPassword: temp}), nil
}

func (s *Service) TransferOwnership(ctx context.Context, req *connect.Request[instancev1.TransferOwnershipRequest]) (*connect.Response[instancev1.TransferOwnershipResponse], error) {
	if err := requireAction(ctx, authctx.InstanceUsersManage); err != nil {
		return nil, err
	}
	u, err := s.users.TransferOwnership(ctx, authctx.UserID(ctx), req.Msg.UserId)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.TransferOwnershipResponse{User: toProtoUser(u)}), nil
}

func (s *Service) RenameUser(ctx context.Context, req *connect.Request[instancev1.RenameUserRequest]) (*connect.Response[instancev1.RenameUserResponse], error) {
	if err := requireAction(ctx, authctx.InstanceUsersManage); err != nil {
		return nil, err
	}
	if req.Msg.UserId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_id is required"))
	}
	if req.Msg.Username == nil && req.Msg.DisplayName == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("nothing to change"))
	}
	if err := s.requireOutranks(ctx, req.Msg.UserId); err != nil {
		return nil, err
	}
	u, err := s.users.RenameUser(ctx, req.Msg.UserId, req.Msg.Username, req.Msg.DisplayName)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.RenameUserResponse{User: toProtoUser(u)}), nil
}

// ClearUserProfile takes down another account's pronouns and/or bio.
// Clearing only — see the RPC comment. Unrecorded, like RenameUser above
// it; STOOP-121 covers giving moderation a trail.
func (s *Service) ClearUserProfile(ctx context.Context, req *connect.Request[instancev1.ClearUserProfileRequest]) (*connect.Response[instancev1.ClearUserProfileResponse], error) {
	if err := requireAction(ctx, authctx.InstanceUsersManage); err != nil {
		return nil, err
	}
	if req.Msg.UserId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_id is required"))
	}
	if !req.Msg.Pronouns && !req.Msg.Bio {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("nothing to clear"))
	}
	if err := s.requireOutranks(ctx, req.Msg.UserId); err != nil {
		return nil, err
	}
	u, err := s.users.ClearUserProfile(ctx, req.Msg.UserId, req.Msg.Pronouns, req.Msg.Bio)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.ClearUserProfileResponse{User: toProtoUser(u)}), nil
}

func (s *Service) SetUsernameFrozen(ctx context.Context, req *connect.Request[instancev1.SetUsernameFrozenRequest]) (*connect.Response[instancev1.SetUsernameFrozenResponse], error) {
	if err := requireAction(ctx, authctx.InstanceUsersManage); err != nil {
		return nil, err
	}
	if req.Msg.UserId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_id is required"))
	}
	// Freezing is a moderation tool for members; admins moderate each
	// other by demoting first.
	if req.Msg.Frozen {
		users, err := s.users.ListUsers(ctx)
		if err != nil {
			return nil, fmt.Errorf("list users: %w", err)
		}
		for _, u := range users {
			if u.ID == req.Msg.UserId && u.Role == authctx.RoleAdmin {
				return nil, connect.NewError(connect.CodeInvalidArgument,
					errors.New("you can't freeze an admin's username"))
			}
		}
	}
	u, err := s.users.SetUsernameFrozen(ctx, req.Msg.UserId, req.Msg.Frozen)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.SetUsernameFrozenResponse{User: toProtoUser(u)}), nil
}

// rank orders who may change whose profile: the owner above admins, admins
// above everyone else.
func rank(u UserSummary) int {
	switch {
	case u.IsOwner:
		return 2
	case u.Role == authctx.RoleAdmin:
		return 1
	}
	return 0
}

// requireOutranks lets the caller rename or clear the profile of an
// account only when they rank above it: the owner over admins, admins
// over members. Admins can't do it to each other, nobody can to the
// owner, and your own is the profile page's.
func (s *Service) requireOutranks(ctx context.Context, targetID string) error {
	if targetID == authctx.UserID(ctx) {
		return connect.NewError(connect.CodeInvalidArgument, errors.New("change your own on your profile page"))
	}
	users, err := s.users.ListUsers(ctx)
	if err != nil {
		return fmt.Errorf("list users: %w", err)
	}
	var me, target *UserSummary
	for i := range users {
		switch users[i].ID {
		case authctx.UserID(ctx):
			me = &users[i]
		case targetID:
			target = &users[i]
		}
	}
	if target == nil {
		return connect.NewError(connect.CodeNotFound, errors.New("user not found"))
	}
	if me == nil || rank(*me) <= rank(*target) {
		if target.IsOwner {
			return connect.NewError(connect.CodePermissionDenied,
				errors.New("only the server owner can change the owner's profile"))
		}
		return connect.NewError(connect.CodePermissionDenied,
			errors.New("only the server owner can change another admin's profile"))
	}
	return nil
}

func toProtoUser(u UserSummary) *instancev1.InstanceUser {
	out := &instancev1.InstanceUser{
		Id: u.ID, Username: u.Username, DisplayName: u.DisplayName,
		CreatedAt: timestamppb.New(u.CreatedAt),
	}
	switch u.Role {
	case authctx.RoleAdmin:
		out.Role = authv1.InstanceRole_INSTANCE_ROLE_ADMIN
	default:
		out.Role = authv1.InstanceRole_INSTANCE_ROLE_MEMBER
	}
	if u.DeactivatedAt != nil {
		out.DeactivatedAt = timestamppb.New(*u.DeactivatedAt)
	}
	if u.DeletedAt != nil {
		out.DeletedAt = timestamppb.New(*u.DeletedAt)
	}
	out.Owner = u.IsOwner
	out.UsernameFrozen = u.UsernameFrozen
	out.HasPassword = u.HasPassword
	out.Pronouns = u.Pronouns
	out.Bio = u.Bio
	out.PersonalTokenCount = int32(u.PersonalTokens)
	out.Kind = accesswire.KindToProto(u.Kind)
	return out
}
