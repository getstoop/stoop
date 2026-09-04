package chat_test

import (
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/chat"
	"github.com/Jhut89/stoop/internal/db/dbtest"
	"github.com/Jhut89/stoop/internal/events"
)

func TestBans(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	cal := newUser(t, pool, "cal", authctx.RoleMember)
	operator := newUser(t, pool, "operator", authctx.RoleAdmin)
	beaID := authctx.UserID(bea)

	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id
	invite := func() string {
		inv, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
		if err != nil {
			t.Fatal(err)
		}
		return inv.Msg.Invite.Code
	}
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: invite()})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinSpace(cal, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: invite()})); err != nil {
		t.Fatal(err)
	}

	sub := bus.Subscribe("space:" + spaceID)
	defer sub.Close()

	// A member can't ban; the owner can't be banned; bea is banned by the owner.
	if _, err := svc.BanMember(cal, connect.NewRequest(&chatv1.BanMemberRequest{SpaceId: spaceID, UserId: beaID})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member bans: want permission_denied, got %v", err)
	}
	if _, err := svc.BanMember(cal, connect.NewRequest(&chatv1.BanMemberRequest{SpaceId: spaceID, UserId: authctx.UserID(owner)})); code(err) != connect.CodePermissionDenied {
		t.Errorf("ban owner: want permission_denied, got %v", err)
	}
	if _, err := svc.BanMember(owner, connect.NewRequest(&chatv1.BanMemberRequest{SpaceId: spaceID, UserId: beaID, Reason: "spam"})); err != nil {
		t.Fatalf("owner bans bea: %v", err)
	}
	if ev := nextEvent(t, sub); ev.GetMemberRemoved() == nil || ev.GetMemberRemoved().UserId != beaID || !ev.GetMemberRemoved().Kicked {
		t.Errorf("want MemberRemoved(kicked) for bea, got %v", ev.Payload)
	}
	// Gone, and can't come back by invite; an instance admin can't force
	// their way in by id either while banned.
	if ok, _ := svc.IsSpaceMember(bea, beaID, spaceID); ok {
		t.Errorf("bea still a member")
	}
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: invite()})); code(err) != connect.CodePermissionDenied {
		t.Errorf("banned rejoin: want permission_denied, got %v", err)
	}
	if _, err := svc.BanMember(owner, connect.NewRequest(&chatv1.BanMemberRequest{SpaceId: spaceID, UserId: authctx.UserID(operator)})); err != nil {
		t.Fatalf("ban a non-member: %v", err)
	}
	if _, err := svc.JoinSpace(operator, connect.NewRequest(&chatv1.JoinSpaceRequest{SpaceId: spaceID})); code(err) != connect.CodePermissionDenied {
		t.Errorf("banned admin joins by id: want permission_denied, got %v", err)
	}
	bans, err := svc.ListBans(owner, connect.NewRequest(&chatv1.ListBansRequest{SpaceId: spaceID}))
	if err != nil || len(bans.Msg.Bans) != 2 {
		t.Fatalf("ListBans: %v %v", bans, err)
	}
	var found bool
	for _, b := range bans.Msg.Bans {
		if b.User.Id == beaID && b.Reason == "spam" && b.User.Username == "bea" {
			found = true
		}
	}
	if !found {
		t.Errorf("bea's ban with reason not listed: %v", bans.Msg.Bans)
	}
	if _, err := svc.ListBans(cal, connect.NewRequest(&chatv1.ListBansRequest{SpaceId: spaceID})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member lists bans: %v", err)
	}
	// Unban: rejoin works again.
	if _, err := svc.UnbanMember(owner, connect.NewRequest(&chatv1.UnbanMemberRequest{SpaceId: spaceID, UserId: beaID})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UnbanMember(owner, connect.NewRequest(&chatv1.UnbanMemberRequest{SpaceId: spaceID, UserId: beaID})); code(err) != connect.CodeNotFound {
		t.Errorf("unban twice: want not_found, got %v", err)
	}
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: invite()})); err != nil {
		t.Errorf("rejoin after unban: %v", err)
	}
}
