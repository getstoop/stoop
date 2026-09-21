package app_test

import (
	"strings"
	"testing"
)

// A refusal about one field names it on the wire; one about none doesn't.
func TestE2EFieldViolation(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	stoop, general := h.space(casey, "The Stoop")
	ada := h.person("ada")
	h.join(ada, h.invite(casey, stoop))

	const create = "stoop.chat.v1.ChatService/CreateChannel"
	const update = "stoop.chat.v1.ChatService/UpdateChannel"

	r := h.rpc(casey, create, map[string]any{"spaceId": stoop, "name": "Off Topic"}).
		expect(t, "invalid_argument", "lowercase letters")
	if got := r.field(); got != "name" {
		t.Errorf("malformed name: field = %q, want name", got)
	}
	h.rpc(casey, create, map[string]any{"spaceId": stoop, "name": "garden"}).expect(t, "ok")
	r = h.rpc(casey, update, map[string]any{"channelId": general, "name": "garden"}).
		expect(t, "already_exists")
	if got := r.field(); got != "name" {
		t.Errorf("taken name: field = %q, want name", got)
	}
	r = h.rpc(casey, update, map[string]any{"channelId": general, "topic": strings.Repeat("x", 300)}).
		expect(t, "invalid_argument", "topic")
	if got := r.field(); got != "topic" {
		t.Errorf("long topic: field = %q, want topic", got)
	}
	r = h.rpc(ada, create, map[string]any{"spaceId": stoop, "name": "Off Topic"}).
		expect(t, "permission_denied")
	if got := r.field(); got != "" {
		t.Errorf("permission denied: field = %q, want none", got)
	}
}

// Registration names the field it refuses; a wrong password names neither.
func TestE2ERegistrationFieldViolation(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	h.rpc(casey, "stoop.instance.v1.InstanceService/UpdateSettings",
		map[string]any{"registrationPolicy": "REGISTRATION_POLICY_INVITE"}).expect(t, "ok")
	const register = "stoop.auth.v1.AuthService/Register"
	for _, c := range []struct {
		name  string
		req   map[string]any
		code  string
		field string
	}{
		{"short username", map[string]any{"username": "a", "password": password}, "invalid_argument", "username"},
		{"short password", map[string]any{"username": "ada", "password": "short"}, "invalid_argument", "password"},
		{"no invite", map[string]any{"username": "ada", "password": password}, "permission_denied", "invite_code"},
		{"unknown invite", map[string]any{"username": "ada", "password": password, "inviteCode": "nope12345X"}, "not_found", "invite_code"},
	} {
		r := h.rpc("", register, c.req).expect(t, c.code)
		if got := r.field(); got != c.field {
			t.Errorf("%s: field = %q, want %q (%s: %s)", c.name, got, c.field, r.code(), r.message())
		}
	}
	r := h.rpc("", "stoop.auth.v1.AuthService/Login", map[string]any{"username": "casey", "password": "wrong-password"}).
		expect(t, "unauthenticated")
	if got := r.field(); got != "" {
		t.Errorf("wrong password: field = %q, want none", got)
	}
}

// Space settings and the invite form name the field they refuse.
func TestE2ESpaceSettingsFieldViolation(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	stoop, _ := h.space(casey, "The Stoop")
	const update = "stoop.chat.v1.ChatService/UpdateSpace"
	const invite = "stoop.chat.v1.ChatService/CreateInvite"
	for _, c := range []struct {
		name, procedure string
		req             map[string]any
		field           string
	}{
		{"long name", update, map[string]any{"spaceId": stoop, "name": strings.Repeat("x", 101)}, "name"},
		{"long description", update, map[string]any{"spaceId": stoop, "description": strings.Repeat("x", 300)}, "description"},
		{"long welcome", update, map[string]any{"spaceId": stoop, "welcome": strings.Repeat("x", 5000)}, "welcome"},
		{"no uses", invite, map[string]any{"spaceId": stoop, "maxUses": 0}, "max_uses"},
		{"too long a life", invite, map[string]any{"spaceId": stoop, "expiresIn": "99999999s"}, "expires_in"},
		{"owner by invite", invite, map[string]any{"spaceId": stoop, "role": "SPACE_ROLE_OWNER"}, "role"},
	} {
		r := h.rpc(casey, c.procedure, c.req).expect(t, "invalid_argument")
		if got := r.field(); got != c.field {
			t.Errorf("%s: field = %q, want %q (%s)", c.name, got, c.field, r.message())
		}
	}
}
