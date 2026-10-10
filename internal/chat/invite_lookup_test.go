package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// LookupInvite is the one chat procedure without a session: it is what an
// invited stranger sees before they have an account.
func TestLookupInvite(t *testing.T) {
	pool, _, svc := newTestService(t)
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
	preview := res.Msg.Preview
	if preview.SpaceName != "Ravenswood Ave" {
		t.Errorf("space_name = %q", preview.SpaceName)
	}
	if preview.SpaceDescription != "Neighbours between 4th and 7th." {
		t.Errorf("space_description = %q", preview.SpaceDescription)
	}
	if preview.MemberCount != 1 {
		t.Errorf("member_count = %d, want 1", preview.MemberCount)
	}
	if preview.Role != chatv1.SpaceRole_SPACE_ROLE_MEMBER {
		t.Errorf("role = %v, want member", preview.Role)
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

	// The files module's rule for the invite page: a usable code shows its
	// own space's icon and nothing else.
	iconID, otherID := uuid.NewString(), uuid.NewString()
	for _, id := range []string{iconID, otherID} {
		if _, err := pool.Exec(anon, `INSERT INTO files (id, kind, owner_id, content_type, size, sha256, storage_key, name)
			VALUES ($1, 'space_icon', $2, 'image/png', 1, '\x00', $3, 'icon')`, id, authctx.UserID(owner), "space_icon/"+id); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.SetSpaceIcon(anon, spaceID, iconID); err != nil {
		t.Fatal(err)
	}
	for name, check := range map[string]struct {
		code, file string
		want       bool
	}{
		"usable code, its icon":   {adminCode, iconID, true},
		"usable code, padded":     {" " + adminCode + " ", iconID, true},
		"usable code, other file": {adminCode, otherID, false},
		"revoked code":            {revoke, iconID, false},
		"unknown code":            {"nosuchcode", iconID, false},
	} {
		got, err := svc.InviteShowsIcon(anon, check.code, check.file)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if got != check.want {
			t.Errorf("%s: shown = %v, want %v", name, got, check.want)
		}
	}
}
