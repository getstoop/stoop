package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

func TestSetSpaceMuted(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	outsider := newUser(t, pool, "outsider", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id

	sub := bus.Subscribe("user:" + authctx.UserID(owner))
	defer sub.Close()
	res, err := svc.SetSpaceMuted(owner, connect.NewRequest(&chatv1.SetSpaceMutedRequest{SpaceId: spaceID, Muted: true}))
	if err != nil || !res.Msg.Space.Muted {
		t.Fatalf("mute: %v %v", res, err)
	}
	if ev := nextEvent(t, sub); ev.GetSpaceMuted() == nil || !ev.GetSpaceMuted().Muted || ev.GetSpaceMuted().SpaceId != spaceID {
		t.Errorf("want SpaceMuted on the personal topic, got %v", ev.Payload)
	}
	// Idempotent, and visible in the space list.
	if _, err := svc.SetSpaceMuted(owner, connect.NewRequest(&chatv1.SetSpaceMutedRequest{SpaceId: spaceID, Muted: true})); err != nil {
		t.Errorf("mute twice: %v", err)
	}
	if !spaceMuted(t, svc, owner, spaceID) {
		t.Errorf("ListSpaces doesn't show the mute")
	}
	if _, err := svc.SetSpaceMuted(owner, connect.NewRequest(&chatv1.SetSpaceMutedRequest{SpaceId: spaceID, Muted: false})); err != nil {
		t.Fatal(err)
	}
	if spaceMuted(t, svc, owner, spaceID) {
		t.Errorf("ListSpaces still shows the mute after unmuting")
	}
	if _, err := svc.SetSpaceMuted(outsider, connect.NewRequest(&chatv1.SetSpaceMutedRequest{SpaceId: spaceID, Muted: true})); code(err) != connect.CodePermissionDenied {
		t.Errorf("outsider mute: want permission_denied, got %v", err)
	}
}

// Leaving and being kicked both drop the mute, so a rejoin starts quiet
// only if the person asks for it again.
func TestSpaceMuteDroppedOnLeaveAndKick(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	member := newUser(t, pool, "member", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id
	inv, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	join := func() {
		t.Helper()
		if _, err := svc.JoinSpace(member, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
			t.Fatal(err)
		}
	}
	mute := func() {
		t.Helper()
		if _, err := svc.SetSpaceMuted(member, connect.NewRequest(&chatv1.SetSpaceMutedRequest{SpaceId: spaceID, Muted: true})); err != nil {
			t.Fatal(err)
		}
	}

	join()
	mute()
	if _, err := svc.LeaveSpace(member, connect.NewRequest(&chatv1.LeaveSpaceRequest{SpaceId: spaceID})); err != nil {
		t.Fatal(err)
	}
	join()
	if spaceMuted(t, svc, member, spaceID) {
		t.Errorf("leaving didn't drop the space mute")
	}

	mute()
	if _, err := svc.KickMember(owner, connect.NewRequest(&chatv1.KickMemberRequest{
		SpaceId: spaceID, UserId: authctx.UserID(member),
	})); err != nil {
		t.Fatal(err)
	}
	join()
	if spaceMuted(t, svc, member, spaceID) {
		t.Errorf("being kicked didn't drop the space mute")
	}
}

func spaceMuted(t *testing.T, svc *chat.Service, ctx context.Context, spaceID string) bool {
	t.Helper()
	list, err := svc.ListSpaces(ctx, connect.NewRequest(&chatv1.ListSpacesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	for _, sp := range list.Msg.Spaces {
		if sp.Id == spaceID {
			return sp.Muted
		}
	}
	t.Fatalf("space %s not in the caller's list", spaceID)
	return false
}
