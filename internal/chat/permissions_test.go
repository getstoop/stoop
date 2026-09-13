package chat

import (
	"testing"

	"github.com/getstoop/stoop/internal/authctx"
)

func TestAllowed(t *testing.T) {
	all := []authctx.Action{
		authctx.InvitesCreate, authctx.InvitesManage, authctx.ChannelsManage,
		authctx.MembersManage, authctx.SpaceManage, authctx.SpaceTransfer, authctx.SpaceDelete,
	}
	adminSet := map[authctx.Action]bool{
		authctx.InvitesCreate: true, authctx.InvitesManage: true, authctx.ChannelsManage: true,
		authctx.MembersManage: true, authctx.SpaceManage: true,
	}
	ownerSet := map[authctx.Action]bool{}
	for _, p := range all {
		ownerSet[p] = true
	}

	tests := []struct {
		name             string
		actor            actor
		membersCanInvite bool
		want             map[authctx.Action]bool
	}{
		{"non-member", actor{}, true, map[authctx.Action]bool{}},
		{"member", actor{role: RoleMember, member: true}, false, map[authctx.Action]bool{}},
		{"member, space opts in", actor{role: RoleMember, member: true}, true, map[authctx.Action]bool{authctx.InvitesCreate: true}},
		{"admin", actor{role: RoleAdmin, member: true}, false, adminSet},
		{"owner", actor{role: RoleOwner, member: true}, false, ownerSet},
		{"instance admin, not a member", actor{role: RoleAdmin, instanceAdmin: true}, false,
			merge(adminSet, map[authctx.Action]bool{authctx.SpaceDelete: true})},
		{"instance admin who is a plain member", actor{role: RoleAdmin, member: true, instanceAdmin: true}, false,
			merge(adminSet, map[authctx.Action]bool{authctx.SpaceDelete: true})},
		{"instance admin who is the owner", actor{role: RoleOwner, member: true, instanceAdmin: true}, false, ownerSet},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			for _, p := range all {
				if got := allowed(tc.actor, p, tc.membersCanInvite); got != tc.want[p] {
					t.Errorf("%s: got %v, want %v", p, got, tc.want[p])
				}
			}
		})
	}
	if allowed(actor{role: RoleOwner, member: true}, authctx.Action("bogus"), true) {
		t.Error("unknown permission must be denied")
	}
}

func merge(a, b map[authctx.Action]bool) map[authctx.Action]bool {
	out := map[authctx.Action]bool{}
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		out[k] = v
	}
	return out
}

func TestRoleOrdering(t *testing.T) {
	if !RoleOwner.atLeast(RoleAdmin) || !RoleAdmin.atLeast(RoleMember) || RoleMember.atLeast(RoleAdmin) {
		t.Error("owner > admin > member ordering broken")
	}
	if Role("").atLeast(RoleMember) {
		t.Error("empty role must rank below member")
	}
}

func TestMemberActions(t *testing.T) {
	for _, p := range []authctx.Action{authctx.SpaceRead, authctx.MessagesRead, authctx.MessagesPost, authctx.VoiceJoin} {
		if !allowed(actor{role: RoleMember, member: true}, p, false) {
			t.Errorf("member lacks %s", p)
		}
		if allowed(actor{}, p, true) {
			t.Errorf("non-member holds %s", p)
		}
	}
}
