package chat_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

func TestPermissionsEnforced(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), noDirectory{})

	owner := newUser(t, pool, "owner", authctx.RoleMember)
	member := newUser(t, pool, "member", authctx.RoleMember)
	outsider := newUser(t, pool, "outsider", authctx.RoleMember)
	operator := newUser(t, pool, "operator", authctx.RoleAdmin) // instance admin, never joins

	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id

	inv, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatalf("owner CreateInvite: %v", err)
	}
	if _, err := svc.JoinSpace(member, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatalf("member JoinSpace: %v", err)
	}

	deny := func(name string, err error) {
		t.Helper()
		if code(err) != connect.CodePermissionDenied {
			t.Errorf("%s: want permission_denied, got %v", name, err)
		}
	}
	allow := func(name string, err error) {
		t.Helper()
		if err != nil {
			t.Errorf("%s: want success, got %v", name, err)
		}
	}

	// Plain members can't manage anything by default.
	_, err = svc.CreateInvite(member, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	deny("member CreateInvite", err)
	_, err = svc.ListInvites(member, connect.NewRequest(&chatv1.ListInvitesRequest{SpaceId: spaceID}))
	deny("member ListInvites", err)
	_, err = svc.CreateChannel(member, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: spaceID, Name: "nope"}))
	deny("member CreateChannel", err)
	_, err = svc.RevokeInvite(member, connect.NewRequest(&chatv1.RevokeInviteRequest{InviteId: inv.Msg.Invite.Id}))
	deny("member revoking owner's invite", err)

	// Outsiders get nothing, and can't join without an invite.
	_, err = svc.CreateInvite(outsider, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	deny("outsider CreateInvite", err)
	_, err = svc.JoinSpace(outsider, connect.NewRequest(&chatv1.JoinSpaceRequest{SpaceId: spaceID}))
	deny("outsider JoinSpace by space_id", err)

	// The space can let members invite; then their own invites are revocable by them.
	if _, err := pool.Exec(context.Background(), `UPDATE spaces SET members_can_invite = true WHERE id = $1`, spaceID); err != nil {
		t.Fatal(err)
	}
	minv, err := svc.CreateInvite(member, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	allow("member CreateInvite with members_can_invite", err)
	_, err = svc.ListInvites(member, connect.NewRequest(&chatv1.ListInvitesRequest{SpaceId: spaceID}))
	allow("member ListInvites with members_can_invite", err)
	_, err = svc.RevokeInvite(member, connect.NewRequest(&chatv1.RevokeInviteRequest{InviteId: minv.Msg.Invite.Id}))
	allow("member revoking own invite", err)
	_, err = svc.RevokeInvite(member, connect.NewRequest(&chatv1.RevokeInviteRequest{InviteId: inv.Msg.Invite.Id}))
	deny("member revoking owner's invite (still)", err)
	_, err = svc.CreateChannel(member, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: spaceID, Name: "nope"}))
	deny("member CreateChannel (still)", err)

	// Owner holds everything.
	_, err = svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: spaceID, Name: "random"}))
	allow("owner CreateChannel", err)

	// Instance admin: full admin powers without ever joining, then may join sans invite.
	_, err = svc.CreateChannel(operator, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: spaceID, Name: "ops"}))
	allow("instance admin CreateChannel as non-member", err)
	_, err = svc.RevokeInvite(operator, connect.NewRequest(&chatv1.RevokeInviteRequest{InviteId: inv.Msg.Invite.Id}))
	allow("instance admin revoking owner's invite", err)
	_, err = svc.JoinSpace(operator, connect.NewRequest(&chatv1.JoinSpaceRequest{SpaceId: spaceID}))
	allow("instance admin JoinSpace by space_id", err)

	var role string
	if err := pool.QueryRow(context.Background(),
		`SELECT role FROM space_members WHERE space_id = $1 AND user_id = $2`, spaceID, authctx.UserID(operator)).Scan(&role); err != nil {
		t.Fatal(err)
	}
	if role != "member" {
		t.Errorf("instance admin joined with role %q, want member (powers come from the instance role)", role)
	}
	if err := pool.QueryRow(context.Background(),
		`SELECT role FROM space_members WHERE space_id = $1 AND user_id = $2`, spaceID, authctx.UserID(owner)).Scan(&role); err != nil {
		t.Fatal(err)
	}
	if role != "owner" {
		t.Errorf("creator has role %q, want owner", role)
	}
}

func TestOneOwnerPerSpace(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), noDirectory{})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	other := newUser(t, pool, "other", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(context.Background(),
		`INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, 'owner')`, sp.Msg.Space.Id, authctx.UserID(other))
	if err == nil {
		t.Fatal("second owner row was accepted; the partial unique index is missing")
	}
	if fmt.Sprint(err) == "" {
		t.Fatal("unexpected empty error")
	}
}

func memberRole(t *testing.T, pool *pgxpool.Pool, spaceID string, ctx context.Context) string {
	t.Helper()
	var role string
	err := pool.QueryRow(context.Background(),
		`SELECT role FROM space_members WHERE space_id = $1 AND user_id = $2`, spaceID, authctx.UserID(ctx)).Scan(&role)
	if err != nil {
		t.Fatal(err)
	}
	return role
}

func TestInviteRoles(t *testing.T) {
	pool, _, svc := newTestService(t)

	owner := newUser(t, pool, "owner", authctx.RoleMember)
	admin := newUser(t, pool, "admin", authctx.RoleMember)
	member := newUser(t, pool, "member", authctx.RoleMember)
	operator := newUser(t, pool, "operator", authctx.RoleAdmin)
	joiners := make([]context.Context, 0)
	for index := range 6 {
		joiners = append(joiners, newUser(t, pool, fmt.Sprintf("joiner%d", index), authctx.RoleMember))
	}

	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id
	if sp.Msg.Space.MyRole != chatv1.SpaceRole_SPACE_ROLE_OWNER {
		t.Errorf("creator's my_role = %v, want owner", sp.Msg.Space.MyRole)
	}

	mk := func(ctx context.Context, role chatv1.SpaceRole) (*chatv1.Invite, error) {
		res, err := svc.CreateInvite(ctx, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID, Role: role}))
		if err != nil {
			return nil, err
		}
		return res.Msg.Invite, nil
	}
	join := func(ctx context.Context, inv *chatv1.Invite) *chatv1.Space {
		t.Helper()
		res, err := svc.JoinSpace(ctx, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Code}))
		if err != nil {
			t.Fatalf("join with %s invite: %v", inv.Role, err)
		}
		return res.Msg.Space
	}

	// Every invite grants member: unset and MEMBER both work, and even the
	// owner can't mint an admin invite. Admins are made after they join.
	defInv, err := mk(owner, chatv1.SpaceRole_SPACE_ROLE_UNSPECIFIED)
	if err != nil {
		t.Fatal(err)
	}
	if defInv.Role != chatv1.SpaceRole_SPACE_ROLE_MEMBER {
		t.Errorf("invite role = %v, want member", defInv.Role)
	}
	if got := join(member, defInv); got.MyRole != chatv1.SpaceRole_SPACE_ROLE_MEMBER {
		t.Errorf("default invite my_role = %v, want member", got.MyRole)
	}
	if _, err := mk(owner, chatv1.SpaceRole_SPACE_ROLE_MEMBER); err != nil {
		t.Errorf("owner minting member invite: %v", err)
	}
	if _, err := mk(owner, chatv1.SpaceRole_SPACE_ROLE_ADMIN); code(err) != connect.CodeInvalidArgument {
		t.Errorf("admin invite: want invalid_argument, got %v", err)
	}
	if _, err := mk(owner, chatv1.SpaceRole_SPACE_ROLE_OWNER); code(err) != connect.CodeInvalidArgument {
		t.Errorf("owner invite: want invalid_argument, got %v", err)
	}
	if got := join(admin, defInv); got.MyRole != chatv1.SpaceRole_SPACE_ROLE_MEMBER {
		t.Errorf("future admin joins as %v, want member", got.MyRole)
	}
	if _, err := svc.SetMemberRole(owner, connect.NewRequest(&chatv1.SetMemberRoleRequest{
		SpaceId: spaceID, UserId: authctx.UserID(admin), Role: chatv1.SpaceRole_SPACE_ROLE_ADMIN,
	})); err != nil {
		t.Fatal(err)
	}
	if role := memberRole(t, pool, spaceID, admin); role != "admin" {
		t.Errorf("promoted joiner stored role = %q", role)
	}

	// A member allowed to invite is refused the same way.
	if _, err := pool.Exec(context.Background(), `UPDATE spaces SET members_can_invite = true WHERE id = $1`, spaceID); err != nil {
		t.Fatal(err)
	}
	if _, err := mk(member, chatv1.SpaceRole_SPACE_ROLE_ADMIN); code(err) != connect.CodeInvalidArgument {
		t.Errorf("member minting admin invite: want invalid_argument, got %v", err)
	}
	if _, err := mk(member, chatv1.SpaceRole_SPACE_ROLE_MEMBER); err != nil {
		t.Errorf("member minting member invite: %v", err)
	}

	// An admin invite from before they were withdrawn still grants admin
	// while its creator holds the role...
	byAdmin := legacyAdminInvite(t, pool, spaceID, admin, "LegacyAdm1")
	if got := join(joiners[0], byAdmin); got.MyRole != chatv1.SpaceRole_SPACE_ROLE_ADMIN {
		t.Errorf("joiner via admin's invite my_role = %v, want admin", got.MyRole)
	}
	// ...but once demoted, their outstanding admin invite only grants member.
	if _, err := pool.Exec(context.Background(),
		`UPDATE space_members SET role = 'member' WHERE space_id = $1 AND user_id = $2`, spaceID, authctx.UserID(admin)); err != nil {
		t.Fatal(err)
	}
	if got := join(joiners[1], byAdmin); got.MyRole != chatv1.SpaceRole_SPACE_ROLE_MEMBER {
		t.Errorf("after demotion, joiner my_role = %v, want member", got.MyRole)
	}
	// ...and if they leave entirely, same.
	if _, err := pool.Exec(context.Background(),
		`DELETE FROM space_members WHERE space_id = $1 AND user_id = $2`, spaceID, authctx.UserID(admin)); err != nil {
		t.Fatal(err)
	}
	if got := join(joiners[2], byAdmin); got.MyRole != chatv1.SpaceRole_SPACE_ROLE_MEMBER {
		t.Errorf("after creator left, joiner my_role = %v, want member", got.MyRole)
	}

	// An old admin invite from an instance admin (never joined) survives
	// join-time capping, since they hold admin everywhere.
	byOperator := legacyAdminInvite(t, pool, spaceID, operator, "LegacyAdm2")
	if got := join(joiners[3], byOperator); got.MyRole != chatv1.SpaceRole_SPACE_ROLE_ADMIN {
		t.Errorf("joiner via instance admin's invite my_role = %v, want admin", got.MyRole)
	}

	// ListSpaces reports each caller's own role.
	ls, err := svc.ListSpaces(joiners[3], connect.NewRequest(&chatv1.ListSpacesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(ls.Msg.Spaces) != 1 || ls.Msg.Spaces[0].MyRole != chatv1.SpaceRole_SPACE_ROLE_ADMIN || !ls.Msg.Spaces[0].MembersCanInvite {
		t.Errorf("ListSpaces = %+v", ls.Msg.Spaces)
	}
}

func TestGetMember(t *testing.T) {
	pool, _, svc := newTestService(t)
	owner := newUser(t, pool, "owner", authctx.RoleAdmin) // also the operator
	member := newUser(t, pool, "member", authctx.RoleMember)
	outsider := newUser(t, pool, "outsider", authctx.RoleMember)

	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id
	inv, _ := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if _, err := svc.JoinSpace(member, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}

	// A member looks up the owner.
	res, err := svc.GetMember(member, connect.NewRequest(&chatv1.GetMemberRequest{SpaceId: spaceID, UserId: authctx.UserID(owner)}))
	if err != nil {
		t.Fatal(err)
	}
	seen := res.Msg.Member
	if seen.Username != "owner" || seen.Role != chatv1.SpaceRole_SPACE_ROLE_OWNER || !seen.InstanceAdmin || seen.JoinedAt == nil {
		t.Errorf("owner as seen by member = %+v", seen)
	}
	// The owner looks up the member.
	res, err = svc.GetMember(owner, connect.NewRequest(&chatv1.GetMemberRequest{SpaceId: spaceID, UserId: authctx.UserID(member)}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Member.Role != chatv1.SpaceRole_SPACE_ROLE_MEMBER || res.Msg.Member.InstanceAdmin {
		t.Errorf("member as seen by owner = %+v", res.Msg.Member)
	}
	// Outsiders can't look, and non-members aren't found.
	_, err = svc.GetMember(outsider, connect.NewRequest(&chatv1.GetMemberRequest{SpaceId: spaceID, UserId: authctx.UserID(owner)}))
	if code(err) != connect.CodePermissionDenied {
		t.Errorf("outsider GetMember: want permission_denied, got %v", err)
	}
	_, err = svc.GetMember(owner, connect.NewRequest(&chatv1.GetMemberRequest{SpaceId: spaceID, UserId: authctx.UserID(outsider)}))
	if code(err) != connect.CodeNotFound {
		t.Errorf("GetMember on non-member: want not_found, got %v", err)
	}
}

type fixedPolicy bool

func (p fixedPolicy) MembersMayCreateSpaces(context.Context) (bool, error) { return bool(p), nil }
func (p fixedPolicy) MessageRetentionDays(context.Context) (int, error)    { return 0, nil }
func (fixedPolicy) VoiceAvailable() bool                                   { return true }

func TestSpaceCreationPolicy(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), noDirectory{})
	member := newUser(t, pool, "member", authctx.RoleMember)
	admin := newUser(t, pool, "admin", authctx.RoleAdmin)

	svc.UseInstancePolicy(fixedPolicy(false))
	if _, err := svc.CreateSpace(member, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Nope"})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member under admins-only: want permission_denied, got %v", err)
	}
	if _, err := svc.CreateSpace(admin, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Ok"})); err != nil {
		t.Errorf("admin under admins-only: %v", err)
	}
	svc.UseInstancePolicy(fixedPolicy(true))
	if _, err := svc.CreateSpace(member, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Now ok"})); err != nil {
		t.Errorf("member under everyone: %v", err)
	}
}
