package chat

import "testing"

func TestAllowed(t *testing.T) {
	all := []Permission{
		PermCreateInvites, PermManageInvites, PermManageChannels,
		PermManageMembers, PermManageSpace, PermTransferOwnership, PermDeleteSpace,
	}
	adminSet := map[Permission]bool{
		PermCreateInvites: true, PermManageInvites: true, PermManageChannels: true,
		PermManageMembers: true, PermManageSpace: true,
	}
	ownerSet := map[Permission]bool{}
	for _, p := range all {
		ownerSet[p] = true
	}

	tests := []struct {
		name             string
		actor            actor
		membersCanInvite bool
		want             map[Permission]bool
	}{
		{"non-member", actor{}, true, map[Permission]bool{}},
		{"member", actor{role: RoleMember, member: true}, false, map[Permission]bool{}},
		{"member, space opts in", actor{role: RoleMember, member: true}, true, map[Permission]bool{PermCreateInvites: true}},
		{"admin", actor{role: RoleAdmin, member: true}, false, adminSet},
		{"owner", actor{role: RoleOwner, member: true}, false, ownerSet},
		{"instance admin, not a member", actor{role: RoleAdmin, instanceAdmin: true}, false,
			merge(adminSet, map[Permission]bool{PermDeleteSpace: true})},
		{"instance admin who is a plain member", actor{role: RoleAdmin, member: true, instanceAdmin: true}, false,
			merge(adminSet, map[Permission]bool{PermDeleteSpace: true})},
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
	if allowed(actor{role: RoleOwner, member: true}, Permission("bogus"), true) {
		t.Error("unknown permission must be denied")
	}
}

func merge(a, b map[Permission]bool) map[Permission]bool {
	out := map[Permission]bool{}
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
