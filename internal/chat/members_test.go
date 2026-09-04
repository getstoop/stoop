package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

type fixture struct {
	svc                                   *chat.Service
	bus                                   *events.InProcBus
	spaceID                               string
	owner, admin, member, other, operator context.Context
}

// newFixture builds a space with an owner, an admin, two members, and an
// instance admin who hasn't joined.
func newFixture(t *testing.T) fixture {
	t.Helper()
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	f := fixture{svc: svc, bus: bus,
		owner: newUser(t, pool, "owner", authctx.RoleMember), admin: newUser(t, pool, "admin", authctx.RoleMember),
		member: newUser(t, pool, "member", authctx.RoleMember), other: newUser(t, pool, "other", authctx.RoleMember),
		operator: newUser(t, pool, "operator", authctx.RoleAdmin)}
	sp, err := svc.CreateSpace(f.owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	f.spaceID = sp.Msg.Space.Id
	adminInv, _ := svc.CreateInvite(f.owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: f.spaceID, Role: chatv1.SpaceRole_SPACE_ROLE_ADMIN}))
	memberInv, _ := svc.CreateInvite(f.owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: f.spaceID}))
	// Join in a fixed order: ListMembers sorts by role then joined_at.
	for _, j := range []struct {
		ctx context.Context
		inv *chatv1.Invite
	}{{f.admin, adminInv.Msg.Invite}, {f.member, memberInv.Msg.Invite}, {f.other, memberInv.Msg.Invite}} {
		if _, err := svc.JoinSpace(j.ctx, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: j.inv.Code})); err != nil {
			t.Fatal(err)
		}
	}
	return f
}

func (f fixture) setRole(ctx context.Context, target context.Context, role chatv1.SpaceRole) error {
	_, err := f.svc.SetMemberRole(ctx, connect.NewRequest(&chatv1.SetMemberRoleRequest{
		SpaceId: f.spaceID, UserId: authctx.UserID(target), Role: role,
	}))
	return err
}

func (f fixture) kick(ctx context.Context, target context.Context) error {
	_, err := f.svc.KickMember(ctx, connect.NewRequest(&chatv1.KickMemberRequest{SpaceId: f.spaceID, UserId: authctx.UserID(target)}))
	return err
}

func TestListMembers(t *testing.T) {
	f := newFixture(t)
	res, err := f.svc.ListMembers(f.member, connect.NewRequest(&chatv1.ListMembersRequest{SpaceId: f.spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	got := []string{}
	for _, m := range res.Msg.Members {
		got = append(got, m.Username+":"+m.Role.String())
	}
	want := "[owner:SPACE_ROLE_OWNER admin:SPACE_ROLE_ADMIN member:SPACE_ROLE_MEMBER other:SPACE_ROLE_MEMBER]"
	if s := stringify(got); s != want {
		t.Errorf("members = %s, want %s", s, want)
	}
	if _, err := f.svc.ListMembers(f.operator, connect.NewRequest(&chatv1.ListMembersRequest{SpaceId: f.spaceID})); code(err) != connect.CodePermissionDenied {
		t.Errorf("non-member instance admin ListMembers: want permission_denied (read paths need membership), got %v", err)
	}
}

func stringify(ss []string) string {
	out := "["
	for i, s := range ss {
		if i > 0 {
			out += " "
		}
		out += s
	}
	return out + "]"
}

func TestSetMemberRoleHierarchy(t *testing.T) {
	f := newFixture(t)
	ADMIN, MEMBER, OWNER := chatv1.SpaceRole_SPACE_ROLE_ADMIN, chatv1.SpaceRole_SPACE_ROLE_MEMBER, chatv1.SpaceRole_SPACE_ROLE_OWNER

	// Members can't manage anyone.
	if err := f.setRole(f.member, f.other, ADMIN); code(err) != connect.CodePermissionDenied {
		t.Errorf("member promoting: %v", err)
	}
	// Admin promotes a member, but can't touch a fellow admin or the owner.
	if err := f.setRole(f.admin, f.member, ADMIN); err != nil {
		t.Errorf("admin promoting member: %v", err)
	}
	if err := f.setRole(f.admin, f.member, MEMBER); code(err) != connect.CodePermissionDenied {
		t.Errorf("admin demoting a (now) fellow admin should be denied, got %v", err)
	}
	if err := f.setRole(f.admin, f.owner, ADMIN); code(err) != connect.CodePermissionDenied {
		t.Errorf("admin touching owner: %v", err)
	}
	// Owner demotes admins; nobody can set OWNER through this RPC.
	if err := f.setRole(f.owner, f.member, MEMBER); err != nil {
		t.Errorf("owner demoting: %v", err)
	}
	if err := f.setRole(f.owner, f.admin, OWNER); code(err) != connect.CodeInvalidArgument {
		t.Errorf("setting owner: want invalid_argument, got %v", err)
	}
	// Instance admin (not a member) can demote a space admin.
	if err := f.setRole(f.operator, f.admin, MEMBER); err != nil {
		t.Errorf("instance admin demoting admin: %v", err)
	}
	// Unknown target.
	if err := f.setRole(f.owner, f.operator, ADMIN); code(err) != connect.CodeNotFound {
		t.Errorf("non-member target: want not_found, got %v", err)
	}
}

func TestKickLeaveTransfer(t *testing.T) {
	f := newFixture(t)
	sub := f.bus.Subscribe("space:" + f.spaceID)
	defer sub.Close()

	if err := f.kick(f.member, f.other); code(err) != connect.CodePermissionDenied {
		t.Errorf("member kicking: %v", err)
	}
	if err := f.kick(f.admin, f.owner); code(err) != connect.CodePermissionDenied {
		t.Errorf("admin kicking owner: %v", err)
	}
	if err := f.kick(f.owner, f.owner); code(err) != connect.CodeInvalidArgument {
		t.Errorf("kicking yourself: want invalid_argument, got %v", err)
	}
	if err := f.kick(f.admin, f.other); err != nil {
		t.Errorf("admin kicking member: %v", err)
	}
	ev := <-sub.Events()
	if r := ev.GetMemberRemoved(); r == nil || r.UserId != authctx.UserID(f.other) || !r.Kicked {
		t.Errorf("expected MemberRemoved(kicked) event, got %v", ev)
	}
	if _, err := f.svc.GetMember(f.owner, connect.NewRequest(&chatv1.GetMemberRequest{SpaceId: f.spaceID, UserId: authctx.UserID(f.other)})); code(err) != connect.CodeNotFound {
		t.Errorf("kicked member still present: %v", err)
	}

	// Leaving: owner can't; member can, and the event says it wasn't a kick.
	if _, err := f.svc.LeaveSpace(f.owner, connect.NewRequest(&chatv1.LeaveSpaceRequest{SpaceId: f.spaceID})); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("owner leaving: want failed_precondition, got %v", err)
	}
	if _, err := f.svc.LeaveSpace(f.member, connect.NewRequest(&chatv1.LeaveSpaceRequest{SpaceId: f.spaceID})); err != nil {
		t.Errorf("member leaving: %v", err)
	}
	if r := (<-sub.Events()).GetMemberRemoved(); r == nil || r.Kicked {
		t.Errorf("expected MemberRemoved(left) event")
	}

	// Transfer: only the owner; target must be a member; roles swap and owner_id follows.
	if _, err := f.svc.TransferOwnership(f.admin, connect.NewRequest(&chatv1.TransferOwnershipRequest{SpaceId: f.spaceID, UserId: authctx.UserID(f.admin)})); code(err) != connect.CodePermissionDenied {
		t.Errorf("admin transferring: %v", err)
	}
	if _, err := f.svc.TransferOwnership(f.operator, connect.NewRequest(&chatv1.TransferOwnershipRequest{SpaceId: f.spaceID, UserId: authctx.UserID(f.admin)})); code(err) != connect.CodePermissionDenied {
		t.Errorf("instance admin transferring (not owner): %v", err)
	}
	res, err := f.svc.TransferOwnership(f.owner, connect.NewRequest(&chatv1.TransferOwnershipRequest{SpaceId: f.spaceID, UserId: authctx.UserID(f.admin)}))
	if err != nil {
		t.Fatalf("owner transferring: %v", err)
	}
	if res.Msg.Space.OwnerId != authctx.UserID(f.admin) || res.Msg.Space.MyRole != chatv1.SpaceRole_SPACE_ROLE_ADMIN {
		t.Errorf("after transfer: %+v", res.Msg.Space)
	}
	roles := map[string]chatv1.SpaceRole{}
	for range 2 {
		if rc := (<-sub.Events()).GetMemberRoleChanged(); rc != nil {
			roles[rc.UserId] = rc.Role
		}
	}
	if roles[authctx.UserID(f.owner)] != chatv1.SpaceRole_SPACE_ROLE_ADMIN || roles[authctx.UserID(f.admin)] != chatv1.SpaceRole_SPACE_ROLE_OWNER {
		t.Errorf("role-changed events = %v", roles)
	}
	// The old owner can now leave.
	if _, err := f.svc.LeaveSpace(f.owner, connect.NewRequest(&chatv1.LeaveSpaceRequest{SpaceId: f.spaceID})); err != nil {
		t.Errorf("old owner leaving after transfer: %v", err)
	}
}

func TestUpdateAndDeleteSpace(t *testing.T) {
	f := newFixture(t)
	sub := f.bus.Subscribe("space:" + f.spaceID)
	defer sub.Close()

	if _, err := f.svc.UpdateSpace(f.member, connect.NewRequest(&chatv1.UpdateSpaceRequest{SpaceId: f.spaceID, Name: proto.String("x")})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member UpdateSpace: %v", err)
	}
	res, err := f.svc.UpdateSpace(f.admin, connect.NewRequest(&chatv1.UpdateSpaceRequest{SpaceId: f.spaceID, MembersCanInvite: proto.Bool(true)}))
	if err != nil {
		t.Fatalf("admin UpdateSpace: %v", err)
	}
	if !res.Msg.Space.MembersCanInvite || res.Msg.Space.Name != "Porch" || res.Msg.Space.MyRole != chatv1.SpaceRole_SPACE_ROLE_ADMIN {
		t.Errorf("after settings update: %+v", res.Msg.Space)
	}
	if u := (<-sub.Events()).GetSpaceUpdated(); u == nil || !u.Space.MembersCanInvite {
		t.Error("expected SpaceUpdated event")
	}
	res, _ = f.svc.UpdateSpace(f.owner, connect.NewRequest(&chatv1.UpdateSpaceRequest{SpaceId: f.spaceID, Name: proto.String("Front Porch")}))
	if res.Msg.Space.Name != "Front Porch" || !res.Msg.Space.MembersCanInvite {
		t.Errorf("after rename: %+v", res.Msg.Space)
	}
	<-sub.Events()
	if _, err := f.svc.UpdateSpace(f.owner, connect.NewRequest(&chatv1.UpdateSpaceRequest{SpaceId: f.spaceID, Name: proto.String("")})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("empty name: %v", err)
	}

	// Delete: admins can't; the instance admin (never joined) can; members see SpaceDeleted.
	if _, err := f.svc.DeleteSpace(f.admin, connect.NewRequest(&chatv1.DeleteSpaceRequest{SpaceId: f.spaceID})); code(err) != connect.CodePermissionDenied {
		t.Errorf("admin DeleteSpace: %v", err)
	}
	if _, err := f.svc.DeleteSpace(f.operator, connect.NewRequest(&chatv1.DeleteSpaceRequest{SpaceId: f.spaceID})); err != nil {
		t.Fatalf("instance admin DeleteSpace: %v", err)
	}
	if d := (<-sub.Events()).GetSpaceDeleted(); d == nil || d.SpaceId != f.spaceID {
		t.Error("expected SpaceDeleted event")
	}
	ls, _ := f.svc.ListSpaces(f.owner, connect.NewRequest(&chatv1.ListSpacesRequest{}))
	if len(ls.Msg.Spaces) != 0 {
		t.Errorf("space still listed after delete: %v", ls.Msg.Spaces)
	}
}

var _ = realtimev1.ServerEvent{}

func TestAddMember(t *testing.T) {
	f := newFixture(t)
	add := func(ctx context.Context, userID string) error {
		_, err := f.svc.AddMember(ctx, connect.NewRequest(&chatv1.AddMemberRequest{
			SpaceId: f.spaceID, UserId: userID,
		}))
		return err
	}
	operatorID := authctx.UserID(f.operator)

	// Plain members can't add people; space admins can.
	if err := add(f.member, operatorID); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("member adding: want permission_denied, got %v", err)
	}
	if err := add(f.admin, operatorID); err != nil {
		t.Fatalf("admin adding: %v", err)
	}
	if _, err := f.svc.GetMember(f.owner, connect.NewRequest(&chatv1.GetMemberRequest{
		SpaceId: f.spaceID, UserId: operatorID,
	})); err != nil {
		t.Errorf("added user is not a member: %v", err)
	}
	// Already in: said so, not silently ignored.
	if err := add(f.admin, operatorID); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Errorf("adding twice: want already_exists, got %v", err)
	}
	// Unknown account.
	if err := add(f.admin, "00000000-0000-0000-0000-000000000000"); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("adding unknown user: want not_found, got %v", err)
	}
	// Banned people stay out.
	otherID := authctx.UserID(f.other)
	if _, err := f.svc.BanMember(f.owner, connect.NewRequest(&chatv1.BanMemberRequest{
		SpaceId: f.spaceID, UserId: otherID,
	})); err != nil {
		t.Fatal(err)
	}
	if err := add(f.admin, otherID); err == nil || connect.CodeOf(err) == connect.CodeAlreadyExists {
		t.Errorf("adding a banned user: want a refusal, got %v", err)
	}
}
