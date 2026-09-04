package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/chat"
	"github.com/Jhut89/stoop/internal/db/dbtest"
	"github.com/Jhut89/stoop/internal/events"
)

// LookupInvite is the one chat procedure without a session: it is what an
// invited stranger sees before they have an account.
func TestLookupInvite(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	anon := context.Background()

	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Ravenswood Ave"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id
	if _, err := svc.UpdateSpace(owner, connect.NewRequest(&chatv1.UpdateSpaceRequest{
		SpaceId:     spaceID,
		Description: ptr("Neighbours between 4th and 7th."),
		Welcome:     ptr("House rules live here."),
	})); err != nil {
		t.Fatal(err)
	}
	newInvite := func(role chatv1.SpaceRole) string {
		t.Helper()
		inv, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{
			SpaceId: spaceID, Role: role,
		}))
		if err != nil {
			t.Fatal(err)
		}
		return inv.Msg.Invite.Code
	}

	code1 := newInvite(chatv1.SpaceRole_SPACE_ROLE_MEMBER)
	res, err := svc.LookupInvite(anon, connect.NewRequest(&chatv1.LookupInviteRequest{Code: code1}))
	if err != nil {
		t.Fatalf("lookup without a session: %v", err)
	}
	p := res.Msg.Preview
	if p.SpaceName != "Ravenswood Ave" {
		t.Errorf("space_name = %q", p.SpaceName)
	}
	if p.SpaceDescription != "Neighbours between 4th and 7th." {
		t.Errorf("space_description = %q", p.SpaceDescription)
	}
	if p.MemberCount != 1 {
		t.Errorf("member_count = %d, want 1", p.MemberCount)
	}
	if p.Role != chatv1.SpaceRole_SPACE_ROLE_MEMBER {
		t.Errorf("role = %v, want member", p.Role)
	}

	// Joining moves the count the preview reports.
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: code1})); err != nil {
		t.Fatal(err)
	}
	res, err = svc.LookupInvite(anon, connect.NewRequest(&chatv1.LookupInviteRequest{Code: code1}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Preview.MemberCount != 2 {
		t.Errorf("member_count after a join = %d, want 2", res.Msg.Preview.MemberCount)
	}

	// The role shown is the one a join would grant today, capped at what
	// the invite's creator still holds.
	adminCode := newInvite(chatv1.SpaceRole_SPACE_ROLE_ADMIN)
	res, err = svc.LookupInvite(anon, connect.NewRequest(&chatv1.LookupInviteRequest{Code: adminCode}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Preview.Role != chatv1.SpaceRole_SPACE_ROLE_ADMIN {
		t.Errorf("role = %v, want admin", res.Msg.Preview.Role)
	}

	if _, err := svc.LookupInvite(anon, connect.NewRequest(&chatv1.LookupInviteRequest{Code: "nosuchcode"})); code(err) != connect.CodeNotFound {
		t.Errorf("unknown code: code = %v, want NotFound", code(err))
	}
	if _, err := svc.LookupInvite(anon, connect.NewRequest(&chatv1.LookupInviteRequest{Code: ""})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("empty code: code = %v, want InvalidArgument", code(err))
	}

	// A spent code says why, rather than pretending it never existed —
	// the same explanation redeeming it would have given.
	revoke := newInvite(chatv1.SpaceRole_SPACE_ROLE_MEMBER)
	list, err := svc.ListInvites(owner, connect.NewRequest(&chatv1.ListInvitesRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	var revokeID string
	for _, inv := range list.Msg.Invites {
		if inv.Code == revoke {
			revokeID = inv.Id
		}
	}
	if _, err := svc.RevokeInvite(owner, connect.NewRequest(&chatv1.RevokeInviteRequest{InviteId: revokeID})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.LookupInvite(anon, connect.NewRequest(&chatv1.LookupInviteRequest{Code: revoke})); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("revoked code: code = %v, want FailedPrecondition", code(err))
	}
}
