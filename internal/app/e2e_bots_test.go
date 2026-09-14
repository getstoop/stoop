package app_test

import (
	"net/http"
	"testing"
)

// A bot's reach is the spaces an instance admin has put it in, and only
// the admin changes that. Every check here drives the real interceptor,
// the real handlers and the real database over HTTP.
func TestE2EBotReachIsItsMembership(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey") // the admin
	stoop, general := h.space(casey, "The Stoop")
	foobar, foobarGeneral := h.space(casey, "Foobar")
	bot := h.bot(casey, "uptime")
	h.addBot(casey, bot, stoop)
	tok := h.botToken(casey, bot, "space.read", "messages.read", "messages.post", "voice.join",
		"preferences.manage", "dms.post", "spaces.create", "invites.create")

	// Inside its space: yes. Outside: no, on every path.
	h.send(tok, general, "inside").expect(t, "ok")
	h.send(tok, foobarGeneral, "outside").expect(t, "permission_denied", "not a member")
	h.list(tok, foobarGeneral).expect(t, "permission_denied")
	h.rpc(tok, "stoop.chat.v1.ChatService/SearchMessages", map[string]any{"spaceId": foobar, "query": "x"}).expect(t, "permission_denied")
	h.rpc(tok, "stoop.chat.v1.ChatService/ListChannels", map[string]any{"spaceId": foobar}).expect(t, "permission_denied")
	if got := h.spaceNames(tok); len(got) != 1 || got[0] != "The Stoop" {
		t.Errorf("ListSpaces = %v", got)
	}

	// It can't widen itself, whatever it was granted.
	h.rpc(tok, "stoop.chat.v1.ChatService/JoinSpace", map[string]any{"code": h.invite(casey, foobar)}).expect(t, "permission_denied", "Server admin")
	h.rpc(tok, "stoop.chat.v1.ChatService/JoinSpace", map[string]any{"spaceId": foobar}).expect(t, "permission_denied")
	h.rpc(tok, "stoop.chat.v1.ChatService/CreateSpace", map[string]any{"name": "Bot's own"}).expect(t, "permission_denied", "can't create a space")
	h.rpc(tok, "stoop.chat.v1.ChatService/LeaveSpace", map[string]any{"spaceId": stoop}).expect(t, "permission_denied")
	h.rpc(tok, "stoop.chat.v1.ChatService/OpenDirectMessage", map[string]any{"userIds": []string{h.userID(casey)}}).expect(t, "permission_denied", "direct messages")
	h.rpc(tok, "stoop.chat.v1.ChatService/CreateInvite", map[string]any{"spaceId": stoop}).expect(t, "permission_denied")
	h.rpc(casey, "stoop.chat.v1.ChatService/AddMember", map[string]any{"spaceId": foobar, "userId": bot}).expect(t, "failed_precondition", "Server admin")

	// A hook never widens it either; inside its space a hook posts.
	h.rpc(casey, "stoop.integrations.v1.IntegrationService/CreateIncoming", map[string]any{
		"channelId": foobarGeneral, "name": "out", "botUserId": bot,
	}).expect(t, "failed_precondition", "isn't in this space")
	hookID, url := h.hook(casey, bot, general, "alerts")
	h.post(url, "text/plain", "via hook").expectStatus(t, http.StatusOK)

	// Removing it from the space cuts the token and the hook off at once;
	// the hook reads as off, and can't be turned on until the bot is back.
	h.removeBot(casey, bot, stoop)
	h.send(tok, general, "after removal").expect(t, "permission_denied", "not a member")
	h.list(tok, general).expect(t, "permission_denied")
	h.post(url, "text/plain", "hook after removal").expectStatus(t, http.StatusNotFound)
	hooks := h.rpc(casey, "stoop.integrations.v1.IntegrationService/ListWebhooks", map[string]any{"spaceId": stoop}).expect(t, "ok")
	if in := hooks.list("incoming"); len(in) != 1 || in[0].(map[string]any)["enabled"] == true || in[0].(map[string]any)["disabledReason"] != "the bot was removed from this space" {
		t.Errorf("hook after removal = %v", in)
	}
	h.rpc(casey, "stoop.integrations.v1.IntegrationService/UpdateIncoming", map[string]any{"id": hookID, "enabled": true}).expect(t, "failed_precondition", "isn't in this space")
	h.rpc(casey, "stoop.auth.v1.AuthService/GetMe", map[string]any{}).expect(t, "ok")

	// Back in: the token works again; the hook waits for an admin.
	h.addBot(casey, bot, stoop)
	h.send(tok, general, "back").expect(t, "ok")
	h.post(url, "text/plain", "still off").expectStatus(t, http.StatusNotFound)
	h.rpc(casey, "stoop.integrations.v1.IntegrationService/UpdateIncoming", map[string]any{"id": hookID, "enabled": true}).expect(t, "ok")
	h.post(url, "text/plain", "on again").expectStatus(t, http.StatusOK)

	// Deactivation kills everything it holds.
	h.rpc(casey, "stoop.integrations.v1.IntegrationService/DeactivateBot", map[string]any{"id": bot}).expect(t, "ok")
	h.send(tok, general, "x").expect(t, "unauthenticated")
	h.post(url, "text/plain", "x").expectStatus(t, http.StatusNotFound)
}

// The instance role is a person's, and what a bot's credentials may be
// granted follows from that.
func TestE2EBotIsNeverAnAdmin(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	bot := h.bot(casey, "opsbot")

	h.rpc(casey, "stoop.instance.v1.InstanceService/SetUserRole", map[string]any{"userId": bot, "role": "INSTANCE_ROLE_ADMIN"}).expect(t, "failed_precondition", "can't be a server admin")
	h.rpc(casey, "stoop.instance.v1.InstanceService/ResetUserPassword", map[string]any{"userId": bot}).expect(t, "failed_precondition", "no password")
	h.rpc(casey, "stoop.instance.v1.InstanceService/SetUsernameFrozen", map[string]any{"userId": bot, "frozen": true}).expect(t, "failed_precondition")
	h.rpc("", "stoop.auth.v1.AuthService/Login", map[string]any{"username": "opsbot", "password": ""}).expect(t, "unauthenticated")

	// Granted the instance action, the token still can't use it: the
	// identity gate asks the role, and a bot's is member.
	tok := h.botToken(casey, bot, "instance.read", "space.read")
	h.rpc(tok, "stoop.instance.v1.InstanceService/ListUsers", map[string]any{}).expect(t, "permission_denied")
	// Nor can it repaint the bot: that is the admin's, from Integrations.
	prof := h.botToken(casey, bot, "profile.manage", "space.read")
	h.rpc(prof, "stoop.auth.v1.AuthService/UpdateProfile", map[string]any{"displayName": "Sneaky"}).expect(t, "failed_precondition", "server admin")
}
