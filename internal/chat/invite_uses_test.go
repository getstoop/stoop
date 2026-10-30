package chat_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// The label is a few trimmed words, kept for the people who list invites.
func TestInviteLabel(t *testing.T) {
	pool, _, svc := newTestService(t)
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id

	res, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{
		SpaceId: spaceID, Label: "  Tuesday book club  ",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Invite.Label != "Tuesday book club" {
		t.Errorf("label = %q, want it trimmed", res.Msg.Invite.Label)
	}
	list, err := svc.ListInvites(owner, connect.NewRequest(&chatv1.ListInvitesRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Msg.Invites) != 1 || list.Msg.Invites[0].Label != "Tuesday book club" {
		t.Errorf("listed label: %+v", list.Msg.Invites)
	}
	if creator := list.Msg.Invites[0].Creator; creator == nil || creator.Username != "owner" {
		t.Errorf("listed creator = %+v, want owner resolved", creator)
	}

	_, err = svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{
		SpaceId: spaceID, Label: strings.Repeat("x", 61),
	}))
	if code(err) != connect.CodeInvalidArgument {
		t.Errorf("61-character label: code = %v, want InvalidArgument", code(err))
	}
	if _, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{
		SpaceId: spaceID, Label: strings.Repeat("é", 60),
	})); err != nil {
		t.Errorf("60 characters, multibyte: %v", err)
	}
}

// Admins see every invite to the space; a member who may invite sees only
// their own.
func TestListInvitesScoped(t *testing.T) {
	pool, _, svc := newTestService(t)
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	admin := newUser(t, pool, "admin", authctx.RoleMember)
	member := newUser(t, pool, "member", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id
	if _, err := pool.Exec(context.Background(), `UPDATE spaces SET members_can_invite = true WHERE id = $1`, spaceID); err != nil {
		t.Fatal(err)
	}
	mk := func(ctx context.Context, label string) *chatv1.Invite {
		t.Helper()
		res, err := svc.CreateInvite(ctx, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID, Label: label}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Invite
	}
	join := func(ctx context.Context, inv *chatv1.Invite) {
		t.Helper()
		if _, err := svc.JoinSpace(ctx, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Code})); err != nil {
			t.Fatal(err)
		}
	}
	first := mk(owner, "first")
	join(admin, first)
	join(member, first)
	if _, err := svc.SetMemberRole(owner, connect.NewRequest(&chatv1.SetMemberRoleRequest{
		SpaceId: spaceID, UserId: authctx.UserID(admin), Role: chatv1.SpaceRole_SPACE_ROLE_ADMIN,
	})); err != nil {
		t.Fatal(err)
	}
	mk(admin, "by admin")
	mk(member, "by member")

	labels := func(ctx context.Context) []string {
		t.Helper()
		res, err := svc.ListInvites(ctx, connect.NewRequest(&chatv1.ListInvitesRequest{SpaceId: spaceID}))
		if err != nil {
			t.Fatal(err)
		}
		out := make([]string, len(res.Msg.Invites))
		for i, inv := range res.Msg.Invites {
			out[i] = inv.Label + " (" + inv.Creator.GetUsername() + ")"
		}
		return out
	}
	want := "by member (member), by admin (admin), first (owner)"
	if got := strings.Join(labels(owner), ", "); got != want {
		t.Errorf("owner sees %q, want %q", got, want)
	}
	if got := strings.Join(labels(admin), ", "); got != want {
		t.Errorf("admin sees %q, want %q", got, want)
	}
	if got := strings.Join(labels(member), ", "); got != "by member (member)" {
		t.Errorf("member sees %q, want only their own", got)
	}
}

// Each join through an invite is recorded, and listed for whoever may
// act on the invite.
func TestInviteUses(t *testing.T) {
	pool, _, svc := newTestService(t)
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	member := newUser(t, pool, "member", authctx.RoleMember)
	ada := newUser(t, pool, "ada", authctx.RoleMember)
	tobi := newUser(t, pool, "tobi", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id
	if _, err := pool.Exec(context.Background(), `UPDATE spaces SET members_can_invite = true WHERE id = $1`, spaceID); err != nil {
		t.Fatal(err)
	}
	mk := func(ctx context.Context) *chatv1.Invite {
		t.Helper()
		res, err := svc.CreateInvite(ctx, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Invite
	}
	join := func(ctx context.Context, inv *chatv1.Invite) {
		t.Helper()
		if _, err := svc.JoinSpace(ctx, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Code})); err != nil {
			t.Fatal(err)
		}
	}
	uses := func(ctx context.Context, inv *chatv1.Invite) ([]string, error) {
		res, err := svc.ListInviteUses(ctx, connect.NewRequest(&chatv1.ListInviteUsesRequest{InviteId: inv.Id}))
		if err != nil {
			return nil, err
		}
		out := make([]string, len(res.Msg.Uses))
		for i, use := range res.Msg.Uses {
			if use.UsedAt == nil {
				t.Errorf("use %d has no used_at", i)
			}
			out[i] = use.User.GetUsername()
		}
		return out, nil
	}

	byOwner := mk(owner)
	join(member, byOwner)
	join(ada, byOwner)
	// A member following the link again is not another use.
	join(ada, byOwner)
	got, err := uses(owner, byOwner)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, ",") != "ada,member" {
		t.Errorf("uses of owner's invite = %v, want ada then member, newest first", got)
	}

	// The member's own invite: they see its joins; the owner's they can't.
	byMember := mk(member)
	join(tobi, byMember)
	got, err = uses(member, byMember)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, ",") != "tobi" {
		t.Errorf("uses of member's invite = %v, want tobi", got)
	}
	if _, err := uses(member, byOwner); code(err) != connect.CodePermissionDenied {
		t.Errorf("member listing owner's invite uses: code = %v, want PermissionDenied", code(err))
	}
	if _, err := uses(owner, byMember); err != nil {
		t.Errorf("owner listing member's invite uses: %v", err)
	}
	// Someone who isn't in the space at all sees nothing either way.
	if _, err := uses(newUser(t, pool, "outsider", authctx.RoleMember), byOwner); code(err) != connect.CodePermissionDenied {
		t.Errorf("outsider: code = %v, want PermissionDenied", code(err))
	}
	if _, err := uses(owner, &chatv1.Invite{Id: byOwner.Id[:len(byOwner.Id)-1] + "0"}); code(err) != connect.CodeNotFound {
		t.Errorf("unknown invite: code = %v, want NotFound", code(err))
	}
}
