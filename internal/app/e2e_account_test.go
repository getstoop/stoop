package app_test

import (
	"strings"
	"testing"
)

// A person deletes their own account (STOOP-222): their messages stay
// under their name marked deleted, everything else goes, the spaces they
// owned are handed on, and the username stays held.
func TestE2EDeleteAccount(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey") // the admin
	ada := h.person("ada")
	bea := h.person("bea")
	adaID := h.userID(ada)
	h.rpc(casey, "stoop.instance.v1.InstanceService/UpdateSettings", map[string]any{"spaceCreation": "SPACE_CREATION_POLICY_EVERYONE"}).expect(t, "ok")

	// ada owns two spaces: one where bea is an admin, one where nobody is.
	shared, sharedGeneral := h.space(ada, "Shared")
	h.join(bea, h.invite(ada, shared))
	h.rpc(ada, "stoop.chat.v1.ChatService/SetMemberRole", map[string]any{"spaceId": shared, "userId": h.userID(bea), "role": "SPACE_ROLE_ADMIN"}).expect(t, "ok")
	alone, _ := h.space(ada, "Alone")
	h.send(ada, sharedGeneral, "I was here").expect(t, "ok")

	// A token never deletes an account, nor does the wrong password.
	pat := h.pat(ada, "messages.read")
	h.rpc(pat, "stoop.auth.v1.AuthService/DeleteAccount", map[string]any{"password": password}).expect(t, "permission_denied")
	h.rpc(ada, "stoop.auth.v1.AuthService/DeleteAccount", map[string]any{"password": "not it"}).expect(t, "invalid_argument", "incorrect")

	// The operator can turn it off.
	h.rpc(casey, "stoop.instance.v1.InstanceService/UpdateSettings", map[string]any{"selfDeletion": false}).expect(t, "ok")
	h.rpc(ada, "stoop.auth.v1.AuthService/DeleteAccount", map[string]any{"password": password}).expect(t, "permission_denied", "ask an admin")
	h.rpc(casey, "stoop.instance.v1.InstanceService/UpdateSettings", map[string]any{"selfDeletion": true}).expect(t, "ok")

	// The last admin can't go.
	h.rpc(casey, "stoop.auth.v1.AuthService/DeleteAccount", map[string]any{"password": password}).expect(t, "failed_precondition", "last active admin")

	h.rpc(ada, "stoop.auth.v1.AuthService/DeleteAccount", map[string]any{"password": password}).expect(t, "ok")

	// Gone: the session, signing in, and the username for anyone else.
	h.rpc(ada, "stoop.auth.v1.AuthService/GetMe", map[string]any{}).expect(t, "unauthenticated")
	h.rpc("", "stoop.auth.v1.AuthService/Login", map[string]any{"username": "ada", "password": password}).expect(t, "unauthenticated")
	h.rpc("", "stoop.auth.v1.AuthService/Register", map[string]any{"username": "ada", "password": password}).expect(t, "already_exists")

	// Kept: the message, under a name that says the account is deleted.
	m := h.message(bea, sharedGeneral, "I was here")
	author := m["author"].(map[string]any)
	if author["deleted"] != true || author["username"] != "ada" || author["displayName"] != "ada" {
		t.Errorf("author after deletion = %v", author)
	}
	profile := h.rpc(bea, "stoop.auth.v1.AuthService/GetUserProfile", map[string]any{"userId": adaID}).expect(t, "ok")
	if !strings.Contains(profile.raw, `"deleted":true`) || strings.Contains(profile.raw, `"bio":`) {
		t.Errorf("profile after deletion = %s", profile.raw)
	}

	// Handed on: the shared space to its admin, the other to the longest-
	// serving instance admin, who is joined to it. ada is in neither.
	if got := h.rpc(bea, "stoop.chat.v1.ChatService/GetSpace", map[string]any{"spaceId": shared}).expect(t, "ok").str("space.ownerId"); got != h.userID(bea) {
		t.Errorf("shared space owner = %s, want bea", got)
	}
	if got := h.rpc(casey, "stoop.chat.v1.ChatService/GetSpace", map[string]any{"spaceId": alone}).expect(t, "ok").str("space.ownerId"); got != h.userID(casey) {
		t.Errorf("lone space owner = %s, want casey", got)
	}
	for _, name := range h.spaceNames(casey) {
		if name == "Alone" {
			goto joined
		}
	}
	t.Error("casey was not joined to the space handed to them")
joined:
	for _, mm := range h.rpc(bea, "stoop.chat.v1.ChatService/ListMembers", map[string]any{"spaceId": shared}).expect(t, "ok").list("members") {
		if mm.(map[string]any)["userId"] == adaID {
			t.Error("ada is still listed as a member")
		}
	}

	// An admin can't bring a deleted account back, and the admin list says why.
	h.rpc(casey, "stoop.instance.v1.InstanceService/SetUserActive", map[string]any{"userId": adaID, "active": true}).expect(t, "failed_precondition", "can't be brought back")
	for _, u := range h.rpc(casey, "stoop.instance.v1.InstanceService/ListUsers", map[string]any{}).expect(t, "ok").list("users") {
		if um := u.(map[string]any); um["id"] == adaID && um["deletedAt"] == nil {
			t.Error("the admin list does not show ada as deleted")
		}
	}
}
