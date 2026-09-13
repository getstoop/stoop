package authctx

import (
	"context"
	"testing"
)

func TestSessionCoversEverything(t *testing.T) {
	session := Credential{Kind: CredentialSession}
	for a := range descriptions {
		if !session.Covers(a) {
			t.Errorf("session should cover %s", a)
		}
	}
}

func TestGrantCoversOnlyItsList(t *testing.T) {
	token := Credential{Kind: "personal_token", Grants: []Action{MessagesRead, AccountSecurity}}
	if !token.Covers(MessagesRead) {
		t.Error("token should cover its grant")
	}
	if token.Covers(ChannelsManage) {
		t.Error("token covers an action it wasn't granted")
	}
	if token.Covers(AccountSecurity) {
		t.Error("account.security must never be covered by a grant")
	}
	if token.Covers(Action("bogus")) {
		t.Error("unknown action covered")
	}
}

func TestRoleHolds(t *testing.T) {
	if !RoleHolds(RoleMember, DMsPost) || !RoleHolds(RoleMember, AccountSecurity) {
		t.Error("everyone holds their own-account actions")
	}
	if RoleHolds(RoleMember, InstanceUsersManage) {
		t.Error("members don't hold instance actions")
	}
	if !RoleHolds(RoleAdmin, InstanceUsersManage) {
		t.Error("admins hold instance actions")
	}
	if RoleHolds(RoleAdmin, ChannelsManage) {
		t.Error("space actions are chat's to answer")
	}
}

func TestAllowsNeedsBothGates(t *testing.T) {
	narrow := WithIdentity(context.Background(), Identity{
		UserID: "u", Role: RoleAdmin,
		Credential: Credential{Kind: "personal_token", Grants: []Action{InstanceRead}},
	})
	if !Allows(narrow, InstanceRead) {
		t.Error("admin with a covering token should be allowed")
	}
	if Allows(narrow, InstanceUsersManage) {
		t.Error("admin role alone must not pass an uncovered action")
	}
	if Allows(context.Background(), InstanceRead) {
		t.Error("no identity allows nothing")
	}
}

func TestRuleCoveredBy(t *testing.T) {
	token := Credential{Grants: []Action{DMsPost}}
	if !(Rule{}).CoveredBy(token) {
		t.Error("an empty rule admits any caller")
	}
	if !(Rule{AnyOf: []Action{MessagesPost, DMsPost}}).CoveredBy(token) {
		t.Error("one covered action is enough")
	}
	if (Rule{AnyOf: []Action{MessagesPost}}).CoveredBy(token) {
		t.Error("rule passed with nothing covered")
	}
}
