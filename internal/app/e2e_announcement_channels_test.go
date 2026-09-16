package app_test

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
)

// An announcement channel: an admin and a hook post; a member doesn't,
// with a session, a token, or an upload.
func TestE2EAnnouncementChannel(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	stoop, news := h.space(casey, "The Stoop")
	ada := h.person("ada")
	h.join(ada, h.invite(casey, stoop))
	bot := h.bot(casey, "uptime")
	h.addBot(casey, bot, stoop)
	_, hook := h.hook(casey, bot, news, "Uptime Kuma")

	h.rpc(ada, "stoop.chat.v1.ChatService/UpdateChannel", map[string]any{"channelId": news, "postPolicy": "CHANNEL_POST_POLICY_ADMINS"}).
		expect(t, "permission_denied")
	h.rpc(casey, "stoop.chat.v1.ChatService/UpdateChannel", map[string]any{"channelId": news, "postPolicy": "CHANNEL_POST_POLICY_ADMINS"}).
		expect(t, "ok")

	h.send(casey, news, "moving boxes on Saturday").expect(t, "ok")
	h.post(hook, "text/plain", "stoop.example.net is up").expectStatus(t, http.StatusOK)
	h.send(ada, news, "nice!").expect(t, "permission_denied", "announcement channel")
	h.send(h.pat(ada, "messages.post"), news, "nice!").expect(t, "permission_denied", "announcement channel")

	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	_ = form.WriteField("channel_id", news)
	part, _ := form.CreateFormFile("file", "note.txt")
	_, _ = part.Write([]byte("hello"))
	_ = form.Close()
	if r := h.post("/files/upload", form.FormDataContentType(), body.String(), "Authorization", "Bearer "+ada).
		expectStatus(t, http.StatusForbidden); !strings.Contains(r.raw, "announcement channel") {
		t.Errorf("upload refused for another reason: %s", r.raw)
	}

	h.rpc(casey, "stoop.chat.v1.ChatService/UpdateChannel", map[string]any{"channelId": news, "postPolicy": "CHANNEL_POST_POLICY_EVERYONE"}).
		expect(t, "ok")
	h.send(ada, news, "thanks").expect(t, "ok")
}
