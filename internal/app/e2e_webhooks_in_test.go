package app_test

import (
	"net/http"
	"strings"
	"testing"
	"unicode/utf8"
)

// An incoming hook is a URL an appliance posts to. It understands the
// bodies appliances already send, posts as its bot through the same path
// as anyone, and answers with a status the appliance can act on.

func TestE2EIncomingHookAdapters(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	stoop, general := h.space(casey, "The Stoop")
	bot := h.bot(casey, "uptime")
	h.addBot(casey, bot, stoop)
	_, url := h.hook(casey, bot, general, "Uptime Kuma")

	for name, tc := range map[string]struct{ ctype, body, want string }{
		"plain text":     {"text/plain", "disk is full", "disk is full"},
		"stoop":          {"application/json", `{"text": "from a script"}`, "from a script"},
		"discord":        {"application/json", `{"content": "[Down] jellyfin", "username": "Kuma", "avatar_url": "x"}`, "[Down] jellyfin"},
		"slack text":     {"application/json", `{"text": "deploy finished", "icon_emoji": ":rocket:"}`, "deploy finished"},
		"slack attach":   {"application/json", `{"attachments": [{"title": "Firing", "text": "DiskFull on nas"}]}`, "Firing\nDiskFull on nas"},
		"json untyped":   {"", `{"text": "no content type"}`, "no content type"},
		"text with json": {"text/plain", `{"text": "posted verbatim"}`, `{"text": "posted verbatim"}`},
	} {
		h.post(url, tc.ctype, tc.body).expectStatus(t, http.StatusOK)
		m := h.message(casey, general, tc.want[:8])
		if m["content"] != tc.want {
			t.Errorf("%s: content = %q, want %q", name, m["content"], tc.want)
		}
		// The payload's username never overrides the bot's own name.
		if a, _ := m["author"].(map[string]any); a["username"] != "uptime" {
			t.Errorf("%s: author = %v", name, m["author"])
		}
	}

	// Nothing to post is a 400; over-length text is cut to fit and posted.
	h.post(url, "text/plain", "   ").expectStatus(t, http.StatusBadRequest)
	h.post(url, "application/json", `{"blocks": []}`).expectStatus(t, http.StatusBadRequest)
	h.post(url, "text/plain", "long "+strings.Repeat("x", 5000)).expectStatus(t, http.StatusOK)
	if c, _ := h.message(casey, general, "long xxx")["content"].(string); utf8.RuneCountInString(c) != 4000 || !strings.HasSuffix(c, "…") {
		t.Errorf("truncated to %d runes, ends %q", utf8.RuneCountInString(c), c[len(c)-3:])
	}
}

func TestE2EIncomingHookAnswers(t *testing.T) {
	h := newHarness(t, "STOOP_WEBHOOK_RATE_LIMIT", "5")
	casey := h.person("casey")
	stoop, general := h.space(casey, "The Stoop")
	bot := h.bot(casey, "uptime")
	h.addBot(casey, bot, stoop)
	hookID, url := h.hook(casey, bot, general, "alerts")

	// Unknown, and a Stoop delivery worker posting back in.
	h.post(h.srv.URL+"/hooks/stp_hook_nope", "text/plain", "x").expectStatus(t, http.StatusNotFound)
	h.post(url, "text/plain", "loop", "User-Agent", "Stoop/0.1 (+https://github.com/getstoop/stoop)").expectStatus(t, http.StatusForbidden)
	// Too big, before anything is read.
	h.post(url, "text/plain", strings.Repeat("x", 300<<10)).expectStatus(t, http.StatusRequestEntityTooLarge)

	// The per-hook limit, keyed on the credential: one hook's bucket is
	// its own, so a chatty sender doesn't starve the others.
	_, ticker := h.hook(casey, bot, general, "ticker")
	for i := 0; i < 5; i++ {
		h.post(ticker, "text/plain", "tick").expectStatus(t, http.StatusOK)
	}
	h.post(ticker, "text/plain", "tick").expectStatus(t, http.StatusTooManyRequests)
	h.post(url, "text/plain", "unaffected").expectStatus(t, http.StatusOK)

	// Rotating mints a new URL and kills the old one.
	rotated := h.rpc(casey, "stoop.integrations.v1.IntegrationService/RotateSecret", map[string]any{"id": hookID}).expect(t, "ok").str("url")
	if strings.HasPrefix(rotated, "/") {
		rotated = h.srv.URL + rotated
	}
	h.post(url, "text/plain", "old").expectStatus(t, http.StatusNotFound)
	h.post(rotated, "text/plain", "new").expectStatus(t, http.StatusOK)

	// Off and on again from the admin page; off for everyone from the
	// server switch, with creation refused too.
	h.rpc(casey, "stoop.integrations.v1.IntegrationService/UpdateIncoming", map[string]any{"id": hookID, "enabled": false}).expect(t, "ok")
	h.post(rotated, "text/plain", "off").expectStatus(t, http.StatusNotFound)
	h.rpc(casey, "stoop.integrations.v1.IntegrationService/UpdateIncoming", map[string]any{"id": hookID, "enabled": true}).expect(t, "ok")
	h.post(rotated, "text/plain", "on").expectStatus(t, http.StatusOK)
	h.rpc(casey, "stoop.instance.v1.InstanceService/UpdateSettings", map[string]any{"webhooksIncoming": false}).expect(t, "ok")
	h.post(rotated, "text/plain", "switched off").expectStatus(t, http.StatusNotFound)
	h.rpc(casey, "stoop.integrations.v1.IntegrationService/CreateIncoming", map[string]any{"channelId": general, "name": "another", "botUserId": bot}).expect(t, "unavailable", "turned off")
	h.rpc(casey, "stoop.instance.v1.InstanceService/UpdateSettings", map[string]any{"webhooksIncoming": true}).expect(t, "ok")

	// Deleting the hooks revokes their credentials; a bot left with
	// nothing is retired, and its messages stay.
	for _, hk := range h.rpc(casey, "stoop.integrations.v1.IntegrationService/ListWebhooks", map[string]any{"spaceId": stoop}).expect(t, "ok").list("incoming") {
		h.rpc(casey, "stoop.integrations.v1.IntegrationService/DeleteWebhook", map[string]any{"id": hk.(map[string]any)["id"]}).expect(t, "ok")
	}
	h.post(rotated, "text/plain", "deleted").expectStatus(t, http.StatusNotFound)
	for _, b := range h.rpc(casey, "stoop.integrations.v1.IntegrationService/ListBots", map[string]any{}).expect(t, "ok").list("bots") {
		if bm := b.(map[string]any); bm["id"] == bot && bm["deactivatedAt"] == nil {
			t.Error("a bot with no credentials left was not retired")
		}
	}
	h.message(casey, general, "tick")
}

// Pinging everyone takes the hook's grant and the bot's role; ticking the
// box on a hook gives its bot the role, and unticking the last takes it.
func TestE2EIncomingHookNotifyEveryone(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	stoop, general := h.space(casey, "The Stoop")
	bot := h.bot(casey, "ups")
	h.addBot(casey, bot, stoop)
	role := func() string {
		t.Helper()
		for _, m := range h.rpc(casey, "stoop.chat.v1.ChatService/ListMembers", map[string]any{"spaceId": stoop}).expect(t, "ok").list("members") {
			if mm := m.(map[string]any); mm["userId"] == bot {
				return mm["role"].(string)
			}
		}
		return "absent"
	}

	_, quiet := h.hook(casey, bot, general, "quiet")
	h.post(quiet, "text/plain", "@everyone quiet").expectStatus(t, http.StatusOK)
	if h.message(casey, general, "quiet")["mentionsEveryone"] == true {
		t.Error("a hook without the grant pinged everyone")
	}
	if role() != "SPACE_ROLE_MEMBER" {
		t.Errorf("bot role = %s", role())
	}

	loud := h.rpc(casey, "stoop.integrations.v1.IntegrationService/CreateIncoming", map[string]any{
		"channelId": general, "name": "loud", "botUserId": bot, "notifyEveryone": true,
	}).expect(t, "ok")
	loudURL := loud.str("url")
	if strings.HasPrefix(loudURL, "/") {
		loudURL = h.srv.URL + loudURL
	}
	if role() != "SPACE_ROLE_ADMIN" {
		t.Errorf("bot role after a notify hook = %s", role())
	}
	h.post(loudURL, "text/plain", "@everyone loud").expectStatus(t, http.StatusOK)
	if h.message(casey, general, "loud")["mentionsEveryone"] != true {
		t.Error("grant plus role didn't ping everyone")
	}
	// The quiet hook's bot is now admin, but its own grant still lacks it.
	h.post(quiet, "text/plain", "@everyone still quiet").expectStatus(t, http.StatusOK)
	if h.message(casey, general, "still quiet")["mentionsEveryone"] == true {
		t.Error("the grant gate didn't hold once the bot was admin")
	}
	h.rpc(casey, "stoop.integrations.v1.IntegrationService/UpdateIncoming", map[string]any{"id": loud.str("webhook.id"), "notifyEveryone": false}).expect(t, "ok")
	if role() != "SPACE_ROLE_MEMBER" {
		t.Errorf("bot role after unticking = %s", role())
	}
}

// Only instance admins configure any of this; members see the list and
// never a secret; a space holds at most twenty incoming hooks.
func TestE2EIntegrationsAreTheInstanceAdmins(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	ada := h.person("ada")
	stoop, general := h.space(casey, "The Stoop")
	h.join(ada, h.invite(casey, stoop))
	// ada owns a space of her own: made by the admin, then handed over.
	adas, adasGeneral := h.space(casey, "Ada's")
	h.join(ada, h.invite(casey, adas))
	h.rpc(casey, "stoop.chat.v1.ChatService/TransferOwnership", map[string]any{"spaceId": adas, "userId": h.userID(ada)}).expect(t, "ok")
	bot := h.bot(casey, "uptime")
	h.addBot(casey, bot, stoop)
	_, url := h.hook(casey, bot, general, "alerts")
	secret := url[strings.LastIndex(url, "/")+1:]

	// A space owner is not enough.
	h.rpc(ada, "stoop.integrations.v1.IntegrationService/CreateIncoming", map[string]any{"channelId": adasGeneral, "name": "mine"}).expect(t, "permission_denied")
	h.rpc(ada, "stoop.integrations.v1.IntegrationService/CreateBot", map[string]any{"username": "mine", "displayName": "Mine"}).expect(t, "permission_denied")
	h.rpc(ada, "stoop.integrations.v1.IntegrationService/ListBots", map[string]any{}).expect(t, "permission_denied")
	h.rpc(ada, "stoop.integrations.v1.IntegrationService/ListWebhooks", map[string]any{}).expect(t, "permission_denied")
	// Nor is an admin on a token that wasn't granted it.
	h.rpc(h.pat(casey, "space.read", "messages.read"), "stoop.integrations.v1.IntegrationService/ListBots", map[string]any{}).expect(t, "permission_denied", "isn't allowed")

	// A member reads the space's list, with a fingerprint and never the token.
	listed := h.rpc(ada, "stoop.integrations.v1.IntegrationService/ListWebhooks", map[string]any{"spaceId": stoop}).expect(t, "ok")
	in := listed.list("incoming")
	if len(in) != 1 || in[0].(map[string]any)["hint"] != secret[len(secret)-4:] {
		t.Errorf("member's view = %v", in)
	}
	if strings.Contains(listed.raw, secret) {
		t.Error("a listing carried the token")
	}
	h.rpc(ada, "stoop.integrations.v1.IntegrationService/ListWebhooks", map[string]any{"spaceId": adas}).expect(t, "ok")
	stranger := h.person("bea")
	h.rpc(stranger, "stoop.integrations.v1.IntegrationService/ListWebhooks", map[string]any{"spaceId": stoop}).expect(t, "permission_denied", "not a member")

	// Twenty hooks, then no more.
	for i := 1; i < 20; i++ {
		h.hook(casey, bot, general, "hook")
	}
	h.rpc(casey, "stoop.integrations.v1.IntegrationService/CreateIncoming", map[string]any{"channelId": general, "name": "one too many", "botUserId": bot}).expect(t, "resource_exhausted")
}
