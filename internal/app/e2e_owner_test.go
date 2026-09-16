package app_test

import "testing"

// The server owner (STOOP-92): the first account, whom no other admin can
// demote, deactivate or reset, and who alone hands the server on.
func TestE2EServerOwner(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey") // first: admin and owner
	ada := h.person("ada")
	bea := h.person("bea")
	caseyID, adaID, beaID := h.userID(casey), h.userID(ada), h.userID(bea)
	users := "stoop.instance.v1.InstanceService/"
	h.rpc(casey, users+"SetUserRole", map[string]any{"userId": adaID, "role": "INSTANCE_ROLE_ADMIN"}).expect(t, "ok")

	owners := func() []string {
		var out []string
		for _, u := range h.rpc(casey, users+"ListUsers", map[string]any{}).expect(t, "ok").list("users") {
			if m := u.(map[string]any); m["owner"] == true {
				out = append(out, m["username"].(string))
			}
		}
		return out
	}
	if got := owners(); len(got) != 1 || got[0] != "casey" {
		t.Fatalf("owners = %v, want [casey]", got)
	}

	// Another admin can't touch the owner.
	h.rpc(ada, users+"SetUserRole", map[string]any{"userId": caseyID, "role": "INSTANCE_ROLE_MEMBER"}).expect(t, "failed_precondition", "server owner")
	h.rpc(ada, users+"SetUserActive", map[string]any{"userId": caseyID, "active": false}).expect(t, "failed_precondition", "server owner")
	h.rpc(ada, users+"ResetUserPassword", map[string]any{"userId": caseyID}).expect(t, "permission_denied", "only the server owner")

	// Only the owner hands it on, and only to an active admin.
	h.rpc(ada, users+"TransferOwnership", map[string]any{"userId": adaID}).expect(t, "permission_denied", "only the server owner")
	h.rpc(bea, users+"TransferOwnership", map[string]any{"userId": beaID}).expect(t, "permission_denied")
	h.rpc(casey, users+"TransferOwnership", map[string]any{"userId": beaID}).expect(t, "failed_precondition", "make them an admin first")
	h.rpc(casey, users+"TransferOwnership", map[string]any{"userId": "nope"}).expect(t, "not_found")
	h.rpc(casey, users+"TransferOwnership", map[string]any{"userId": adaID}).expect(t, "ok")
	if got := owners(); len(got) != 1 || got[0] != "ada" {
		t.Fatalf("owners after the hand-over = %v, want [ada]", got)
	}

	// casey is an ordinary admin now; ada is the one out of reach.
	h.rpc(casey, users+"TransferOwnership", map[string]any{"userId": caseyID}).expect(t, "permission_denied", "only the server owner")
	h.rpc(casey, users+"SetUserRole", map[string]any{"userId": adaID, "role": "INSTANCE_ROLE_MEMBER"}).expect(t, "failed_precondition", "server owner")
	h.rpc(ada, users+"SetUserRole", map[string]any{"userId": caseyID, "role": "INSTANCE_ROLE_MEMBER"}).expect(t, "ok")
}
