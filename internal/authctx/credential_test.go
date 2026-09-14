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
	if !session.Reaches("", "") || !session.Reaches("s", "c") {
		t.Error("an unbounded credential reaches everything")
	}
}

func TestGrantCoversOnlyItsList(t *testing.T) {
	token := Credential{Kind: CredentialPersonalToken, Grants: []Action{MessagesRead, AccountSecurity}}
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
	if (Credential{Grants: []Action{}}).Covers(MessagesRead) {
		t.Error("an empty grant covers nothing")
	}
}

func TestBounds(t *testing.T) {
	token := Credential{Grants: []Action{MessagesRead}, Bounded: true, Spaces: []string{"homelab"}, Channels: []string{"alerts"}}
	cases := []struct {
		space, channel string
		want           bool
	}{
		{"homelab", "", true},
		{"homelab", "general", true},
		{"bookclub", "alerts", true},
		{"bookclub", "", false},
		{"", "dm", false},
		{"", "", false},
	}
	for _, tc := range cases {
		if got := token.Reaches(tc.space, tc.channel); got != tc.want {
			t.Errorf("Reaches(%q, %q) = %v, want %v", tc.space, tc.channel, got, tc.want)
		}
	}
	// Every bound row gone: bounded still, so it reaches nothing.
	orphan := Credential{Grants: []Action{MessagesRead}, Bounded: true}
	if orphan.Reaches("homelab", "general") {
		t.Error("a bounded credential with no bounds left must reach nothing")
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

func TestContextGates(t *testing.T) {
	with := func(c Credential) context.Context {
		return WithIdentity(context.Background(), Identity{UserID: "u", Role: RoleAdmin, Credential: c})
	}
	narrow := with(Credential{Grants: []Action{InstanceRead}})
	if !Allows(narrow, InstanceRead) {
		t.Error("admin with a covering token should be allowed")
	}
	if Allows(narrow, InstanceUsersManage) {
		t.Error("admin role alone must not pass an uncovered action")
	}
	if Allows(context.Background(), InstanceRead) {
		t.Error("no identity allows nothing")
	}

	bounded := with(Credential{Grants: []Action{InstanceRead, ChannelsManage}, Bounded: true, Spaces: []string{"homelab"}})
	if Allows(bounded, InstanceRead) {
		t.Error("a bounded credential never reaches the instance")
	}
	if !CoversSpace(bounded, ChannelsManage, "homelab") || CoversSpace(bounded, ChannelsManage, "bookclub") {
		t.Error("CoversSpace must follow the bounds")
	}
	if err := Refusal(bounded, ChannelsManage); err != ErrOutOfBounds {
		t.Errorf("refusal for a covered action should blame the bounds, got %v", err)
	}
	if err := Refusal(bounded, SpaceDelete); err == ErrOutOfBounds {
		t.Error("refusal for an uncovered action should blame the grant")
	}
}

func TestBoundedCredentialOnlyUsesSpaceActions(t *testing.T) {
	c := Credential{Grants: []Action{MessagesRead, DMsRead, InstanceRead}, Bounded: true, Spaces: []string{"s"}}
	if !(Rule{AnyOf: []Action{MessagesRead, DMsRead}}).CoveredBy(c) {
		t.Error("a space action in the rule should pass")
	}
	if (Rule{AnyOf: []Action{DMsRead}}).CoveredBy(c) || (Rule{AnyOf: []Action{InstanceRead}}).CoveredBy(c) {
		t.Error("a bounded credential used a DM or instance action")
	}
	unbounded := Credential{Grants: []Action{DMsRead}}
	if !(Rule{AnyOf: []Action{DMsRead}}).CoveredBy(unbounded) {
		t.Error("an unbounded credential should use its DM grant")
	}
	for a := range descriptions {
		if a.OnSpace() && (RoleHolds(RoleAdmin, a) || ownActions[a]) {
			t.Errorf("%s is both a space action and an instance or own-account one", a)
		}
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
