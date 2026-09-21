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

// Hosting and login providers name nested and listed fields by path.
func TestE2EHostingFieldViolation(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	const reach = "stoop.instance.v1.InstanceService/UpdateReachability"
	const providers = "stoop.instance.v1.InstanceService/UpdateLoginProviders"
	google := map[string]any{"id": "google", "issuer": "https://accounts.google.com", "clientId": "c", "clientSecret": "s"}
	for _, c := range []struct {
		name, procedure string
		req             map[string]any
		field           string
	}{
		{"public address", reach, map[string]any{"publicUrl": "chat.example.com"}, "public_url"},
		{"a hostname as a proxy", reach, map[string]any{"trustedProxies": map[string]any{"cidrs": []string{"proxy.example.com"}}}, "trusted_proxies.cidrs"},
		{"a web URL as a relay", reach, map[string]any{"turn": map[string]any{"urls": []string{"https://turn.example.com"}}}, "turn.urls"},
		{"a web URL as a STUN server", reach, map[string]any{"turn": map[string]any{"stunUrls": []string{"https://stun.example.com"}}}, "turn.stun_urls"},
		{"a relay with no username", reach, map[string]any{"turn": map[string]any{"urls": []string{"turn:turn.example.com:3478"}}}, "turn.username"},
		{"a node name with a dot", reach, map[string]any{"tailscale": map[string]any{"hostname": "my.node"}}, "tailscale.hostname"},
		{"a control URL with no scheme", reach, map[string]any{"tailscale": map[string]any{"controlUrl": "headscale"}}, "tailscale.control_url"},
		{"not a tunnel token", reach, map[string]any{"cloudflareTunnel": map[string]any{"enabled": true, "token": "nope"}}, "cloudflare_tunnel.token"},
		{"second provider, no client id", providers, map[string]any{"providers": []any{google, map[string]any{"id": "authentik", "issuer": "https://auth.example.com", "clientSecret": "s"}}}, "providers[1].client_id"},
		{"second provider, bad issuer", providers, map[string]any{"providers": []any{google, map[string]any{"id": "authentik", "issuer": "auth.example.com", "clientId": "c", "clientSecret": "s"}}}, "providers[1].issuer"},
		{"a duplicate id", providers, map[string]any{"providers": []any{google, google}}, "providers[1].id"},
	} {
		r := h.rpc(casey, c.procedure, c.req).expect(t, "invalid_argument")
		if got := r.field(); got != c.field {
			t.Errorf("%s: field = %q, want %q (%s)", c.name, got, c.field, r.message())
		}
	}
}

// Server admin settings name the field they refuse, the two retention
// fields apart.
func TestE2ESettingsFieldViolation(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	const update = "stoop.instance.v1.InstanceService/UpdateSettings"
	for _, c := range []struct {
		name  string
		req   map[string]any
		code  string
		field string
	}{
		{"blank server name", map[string]any{"instanceName": "  "}, "invalid_argument", "instance_name"},
		{"two years signed in", map[string]any{"sessionLifetimeDays": 730}, "invalid_argument", "session_lifetime_days"},
		{"messages kept too long", map[string]any{"messageRetentionDays": 99999}, "invalid_argument", "message_retention_days"},
		{"attachments kept too long", map[string]any{"attachmentRetentionDays": 99999}, "invalid_argument", "attachment_retention_days"},
		{"a negative storage limit", map[string]any{"storageQuotaBytes": "-1"}, "invalid_argument", "storage_quota_bytes"},
		{"a file bigger than the disk", map[string]any{"storageQuotaBytes": "1048576", "maxUploadBytes": "2097152"}, "invalid_argument", "max_upload_bytes"},
		{"passwords off with no provider", map[string]any{"passwordSignIn": "PASSWORD_SIGN_IN_OFF"}, "failed_precondition", "password_sign_in"},
	} {
		r := h.rpc(casey, update, c.req).expect(t, c.code)
		if got := r.field(); got != c.field {
			t.Errorf("%s: field = %q, want %q (%s)", c.name, got, c.field, r.message())
		}
	}
}

// Bots and webhooks name the field they refuse.
func TestE2EIntegrationsFieldViolation(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	stoop, _ := h.space(casey, "The Stoop")
	const svc = "stoop.integrations.v1.IntegrationService/"
	for _, c := range []struct {
		name, procedure string
		req             map[string]any
		field           string
	}{
		{"a one-letter bot", "CreateBot", map[string]any{"username": "x", "displayName": "X"}, "username"},
		{"a bot with no display name", "CreateBot", map[string]any{"username": "uptime", "displayName": ""}, "display_name"},
		{"a hook to an ftp address", "CreateOutgoing", map[string]any{"spaceId": stoop, "name": "Backups", "url": "ftp://backups.example.net", "eventTypes": []string{"message.created"}}, "url"},
		{"a hook with no name", "CreateOutgoing", map[string]any{"spaceId": stoop, "name": " ", "url": "https://backups.example.net", "eventTypes": []string{"message.created"}}, "name"},
	} {
		r := h.rpc(casey, svc+c.procedure, c.req).expect(t, "invalid_argument")
		if got := r.field(); got != c.field {
			t.Errorf("%s: field = %q, want %q (%s)", c.name, got, c.field, r.message())
		}
	}
}
