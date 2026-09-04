package chat_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/chat"
	"github.com/Jhut89/stoop/internal/db/dbtest"
	"github.com/Jhut89/stoop/internal/events"
)

type noDirectory struct{}

func (noDirectory) GetUsers(context.Context, []string) ([]chat.UserRecord, error) { return nil, nil }

// dbDirectory reads users straight from the table, as the auth-backed
// adapter in internal/app would.
type dbDirectory struct{ pool *pgxpool.Pool }

func (d dbDirectory) GetUsers(ctx context.Context, ids []string) ([]chat.UserRecord, error) {
	rows, err := d.pool.Query(ctx, `SELECT id, username, role FROM users WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []chat.UserRecord
	for rows.Next() {
		var r chat.UserRecord
		var role string
		if err := rows.Scan(&r.ID, &r.Username, &role); err != nil {
			return nil, err
		}
		r.InstanceAdmin = role == "admin"
		out = append(out, r)
	}
	return out, rows.Err()
}

// newUser inserts a user row directly; chat may not import auth.
func newUser(t *testing.T, pool *pgxpool.Pool, name string, role authctx.Role) context.Context {
	t.Helper()
	id := uuid.NewString()
	_, err := pool.Exec(context.Background(),
		`INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, '', $3)`, id, name, string(role))
	if err != nil {
		t.Fatal(err)
	}
	return authctx.WithIdentity(context.Background(), authctx.Identity{UserID: id, Role: role})
}

func code(err error) connect.Code {
	var cerr *connect.Error
	if errors.As(err, &cerr) {
		return cerr.Code()
	}
	return 0
}

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
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})

	owner := newUser(t, pool, "owner", authctx.RoleMember)
	admin := newUser(t, pool, "admin", authctx.RoleMember)
	member := newUser(t, pool, "member", authctx.RoleMember)
	operator := newUser(t, pool, "operator", authctx.RoleAdmin)
	joiners := make([]context.Context, 0)
	for i := range 6 {
		joiners = append(joiners, newUser(t, pool, fmt.Sprintf("joiner%d", i), authctx.RoleMember))
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

	// Owner mints an admin invite; the joiner becomes admin.
	adminInv, err := mk(owner, chatv1.SpaceRole_SPACE_ROLE_ADMIN)
	if err != nil {
		t.Fatal(err)
	}
	if adminInv.Role != chatv1.SpaceRole_SPACE_ROLE_ADMIN {
		t.Errorf("invite role = %v, want admin", adminInv.Role)
	}
	if got := join(admin, adminInv); got.MyRole != chatv1.SpaceRole_SPACE_ROLE_ADMIN {
		t.Errorf("admin joiner my_role = %v, want admin", got.MyRole)
	}
	if r := memberRole(t, pool, spaceID, admin); r != "admin" {
		t.Errorf("admin joiner stored role = %q", r)
	}

	// Default (unspecified) grants member.
	defInv, _ := mk(owner, chatv1.SpaceRole_SPACE_ROLE_UNSPECIFIED)
	if got := join(member, defInv); got.MyRole != chatv1.SpaceRole_SPACE_ROLE_MEMBER {
		t.Errorf("default invite my_role = %v, want member", got.MyRole)
	}

	// Nobody can grant owner.
	if _, err := mk(owner, chatv1.SpaceRole_SPACE_ROLE_OWNER); code(err) != connect.CodeInvalidArgument {
		t.Errorf("owner invite: want invalid_argument, got %v", err)
	}

	// A member allowed to invite can only invite members.
	if _, err := pool.Exec(context.Background(), `UPDATE spaces SET members_can_invite = true WHERE id = $1`, spaceID); err != nil {
		t.Fatal(err)
	}
	if _, err := mk(member, chatv1.SpaceRole_SPACE_ROLE_ADMIN); code(err) != connect.CodePermissionDenied {
		t.Errorf("member minting admin invite: want permission_denied, got %v", err)
	}
	if _, err := mk(member, chatv1.SpaceRole_SPACE_ROLE_MEMBER); err != nil {
		t.Errorf("member minting member invite: %v", err)
	}

	// Space admins can grant admin...
	byAdmin, err := mk(admin, chatv1.SpaceRole_SPACE_ROLE_ADMIN)
	if err != nil {
		t.Fatalf("admin minting admin invite: %v", err)
	}
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

	// Instance admin (never joined) can grant admin, and it survives join-time capping.
	byOperator, err := mk(operator, chatv1.SpaceRole_SPACE_ROLE_ADMIN)
	if err != nil {
		t.Fatalf("instance admin minting admin invite: %v", err)
	}
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
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
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
	m := res.Msg.Member
	if m.Username != "owner" || m.Role != chatv1.SpaceRole_SPACE_ROLE_OWNER || !m.InstanceAdmin || m.JoinedAt == nil {
		t.Errorf("owner as seen by member = %+v", m)
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
