package chat

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Role is a member's space-level role. See docs/architecture/permissions.md
// for the model; this file is the whole implementation.
type Role string

const (
	RoleMember Role = "member"
	RoleAdmin  Role = "admin"
	RoleOwner  Role = "owner"
)

func (r Role) rank() int {
	switch r {
	case RoleMember:
		return 1
	case RoleAdmin:
		return 2
	case RoleOwner:
		return 3
	default:
		return 0 // not a member
	}
}

func (r Role) atLeast(o Role) bool { return r.rank() >= o.rank() }

// minRole is the fixed permission table: the least space role that holds
// each space action. Two exceptions live in allowed(): members get
// invites.create when the space opts in, and instance admins get
// space.delete. Reading, posting and voice are actions only so that a
// credential can withhold them.
var minRole = map[authctx.Action]Role{
	authctx.SpaceRead:              RoleMember,
	authctx.MessagesRead:           RoleMember,
	authctx.MessagesPost:           RoleMember,
	authctx.VoiceJoin:              RoleMember,
	authctx.InvitesCreate:          RoleAdmin,
	authctx.InvitesManage:          RoleAdmin,
	authctx.ChannelsManage:         RoleAdmin,
	authctx.MembersManage:          RoleAdmin,
	authctx.SpaceManage:            RoleAdmin,
	authctx.MessagesNotifyEveryone: RoleAdmin,
	authctx.MessagesModerate:       RoleAdmin,
	authctx.SpaceTransfer:          RoleOwner,
	authctx.SpaceDelete:            RoleOwner,
}

// actor is the caller as seen by a specific space.
type actor struct {
	// role is the effective role: the greater of the membership row's role
	// and admin if the caller is an instance admin. Empty when neither.
	role Role
	// member reports whether a space_members row exists. Instance admins
	// hold permissions without one, but aren't members until they join.
	member        bool
	instanceAdmin bool
}

// allowed is the identity gate, pure so it can be tested as a table.
func allowed(a actor, perm authctx.Action, membersCanInvite bool) bool {
	if perm == authctx.InvitesCreate && a.member && membersCanInvite {
		return true
	}
	if perm == authctx.SpaceDelete && a.instanceAdmin {
		return true
	}
	min, ok := minRole[perm]
	return ok && a.role.atLeast(min)
}

// actorFor describes the caller's standing in a space.
func (s *Service) actorFor(ctx context.Context, spaceID string) (actor, error) {
	return s.actorForUser(ctx, spaceID, authctx.UserID(ctx), authctx.IsAdmin(ctx))
}

// actorForUser describes any user's standing in a space; instanceAdmin
// must be supplied by the caller (from the identity, or the directory).
// This is the one place instance admins inherit admin in a space.
func (s *Service) actorForUser(ctx context.Context, spaceID, userID string, instanceAdmin bool) (actor, error) {
	a := actor{instanceAdmin: instanceAdmin}
	role, err := s.q.GetSpaceMemberRole(ctx, dbgen.GetSpaceMemberRoleParams{
		SpaceID: spaceID, UserID: userID,
	})
	switch {
	case err == nil:
		a.member = true
		a.role = Role(role)
	case !errors.Is(err, pgx.ErrNoRows):
		return a, fmt.Errorf("look up member role: %w", err)
	}
	if a.instanceAdmin && !a.role.atLeast(RoleAdmin) {
		a.role = RoleAdmin
	}
	return a, nil
}

// requirePermission is the single enforcement point for actions on a space.
// The credential is checked first, before anything is read; non-members
// (other than instance admins) are refused before the role is considered.
func (s *Service) requirePermission(ctx context.Context, spaceID string, perm authctx.Action) error {
	if !authctx.Covers(ctx, perm) {
		return connect.NewError(connect.CodePermissionDenied, authctx.Uncovered(perm))
	}
	a, err := s.actorFor(ctx, spaceID)
	if err != nil {
		return err
	}
	if !a.member && !a.instanceAdmin {
		return connect.NewError(connect.CodePermissionDenied,
			errors.New("not a member of this space"))
	}

	// Only members below admin need the space's opt-in flag consulted.
	membersCanInvite := false
	if perm == authctx.InvitesCreate && a.member && !a.role.atLeast(RoleAdmin) {
		space, err := s.q.GetSpace(ctx, spaceID)
		if err != nil {
			return notFoundOr(err, "space")
		}
		membersCanInvite = space.MembersCanInvite
	}

	if !allowed(a, perm, membersCanInvite) {
		return connect.NewError(connect.CodePermissionDenied,
			fmt.Errorf("you don't have permission to %s", perm.Describe()))
	}
	return nil
}

// MayReadSpace reports whether the caller in ctx may read a space's
// messages. Exposed for the files module's download check.
func (s *Service) MayReadSpace(ctx context.Context, spaceID string) (bool, error) {
	err := s.requirePermission(ctx, spaceID, authctx.MessagesRead)
	var cerr *connect.Error
	switch {
	case err == nil:
		return true, nil
	case errors.As(err, &cerr) && cerr.Code() == connect.CodePermissionDenied:
		return false, nil
	default:
		return false, err
	}
}

// requireChannelAction is the credential gate for acting in a channel: a
// space action in a space channel, a DM action in a direct message.
// Membership is checked separately.
func requireChannelAction(ctx context.Context, channel dbgen.Channel, inSpace, inDM authctx.Action) error {
	a := inSpace
	if isDM(channel) {
		a = inDM
	}
	if !authctx.Covers(ctx, a) {
		return connect.NewError(connect.CodePermissionDenied, authctx.Uncovered(a))
	}
	return nil
}

// grantableRole validates the role an invite may confer: member or admin,
// never above the granting actor's own effective role.
func grantableRole(a actor, requested Role) error {
	switch requested {
	case RoleMember, RoleAdmin:
	case RoleOwner:
		return connect.NewError(connect.CodeInvalidArgument,
			errors.New("ownership can't be granted by invite; transfer it instead"))
	default:
		return connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("unknown role %q", requested))
	}
	if !a.role.atLeast(requested) {
		return connect.NewError(connect.CodePermissionDenied,
			fmt.Errorf("you can't invite people as %s: that's above your own role", requested))
	}
	return nil
}

// capRole lowers granted to member unless the actor currently holds it.
func capRole(a actor, granted Role) Role {
	if a.role.atLeast(granted) {
		return granted
	}
	return RoleMember
}

func toProtoRole(r Role) chatv1.SpaceRole {
	switch r {
	case RoleOwner:
		return chatv1.SpaceRole_SPACE_ROLE_OWNER
	case RoleAdmin:
		return chatv1.SpaceRole_SPACE_ROLE_ADMIN
	case RoleMember:
		return chatv1.SpaceRole_SPACE_ROLE_MEMBER
	default:
		return chatv1.SpaceRole_SPACE_ROLE_UNSPECIFIED
	}
}

// roleFromProto maps a request role; UNSPECIFIED means member.
func roleFromProto(r chatv1.SpaceRole) Role {
	switch r {
	case chatv1.SpaceRole_SPACE_ROLE_OWNER:
		return RoleOwner
	case chatv1.SpaceRole_SPACE_ROLE_ADMIN:
		return RoleAdmin
	case chatv1.SpaceRole_SPACE_ROLE_MEMBER, chatv1.SpaceRole_SPACE_ROLE_UNSPECIFIED:
		return RoleMember
	default:
		return Role(r.String())
	}
}

// canActOn reports whether an actor may change or remove a member holding
// targetRole: never the owner; the owner and instance admins may act on
// anyone else; everyone else only on members strictly below them.
func canActOn(a actor, targetRole Role) bool {
	if targetRole == RoleOwner {
		return false
	}
	if a.role == RoleOwner || a.instanceAdmin {
		return true
	}
	return a.role.rank() > targetRole.rank()
}
