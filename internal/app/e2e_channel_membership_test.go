package app_test

import (
	"net/http"
	"testing"
)

// A bot is in a channel like anyone before it posts there: a webhook's
// bot is put in the hook's channel, and a bot token joins for itself.
func TestE2EBotsJoinChannelsToPost(t *testing.T) {
	server := newHarness(t)
	casey := server.person("casey")
	stoop, general := server.space(casey, "The Stoop")
	channel := func(name string) string {
		t.Helper()
		return server.rpc(casey, "stoop.chat.v1.ChatService/CreateChannel", map[string]any{"spaceId": stoop, "name": name}).expect(t, "ok").str("channel.id")
	}
	alerts, garden := channel("alerts"), channel("garden")
	bot := server.bot(casey, "uptime")
	server.addBot(casey, bot, stoop)

	// Making the hook is what puts its bot in #alerts.
	_, url := server.hook(casey, bot, alerts, "alerts")
	server.post(url, "text/plain", "disk is full").expectStatus(t, http.StatusOK)
	if server.message(casey, alerts, "disk is full") == nil {
		t.Error("the hook's message is not in #alerts")
	}

	token := server.botToken(casey, bot, "space.read", "messages.read", "messages.post")
	joined := map[string]bool{}
	for _, listed := range server.rpc(token, "stoop.chat.v1.ChatService/ListChannels", map[string]any{"spaceId": stoop}).expect(t, "ok").list("channels") {
		fields := listed.(map[string]any)
		joined[fields["id"].(string)] = fields["joined"] == true
	}
	// A token lists every channel, in it or not.
	if len(joined) != 3 || !joined[general] || !joined[alerts] || joined[garden] {
		t.Errorf("joined by channel = %v, want #general and #alerts but not #garden", joined)
	}

	server.send(token, garden, "watering done").expect(t, "failed_precondition", "join this channel")
	server.list(token, garden).expect(t, "ok")
	server.rpc(token, "stoop.chat.v1.ChatService/JoinChannel", map[string]any{"channelId": garden}).expect(t, "ok")
	server.send(token, garden, "watering done").expect(t, "ok")

	// Joining exists to post: a token that can't post can't join.
	reader := server.botToken(casey, bot, "space.read", "messages.read")
	server.rpc(reader, "stoop.chat.v1.ChatService/LeaveChannel", map[string]any{"channelId": garden}).expect(t, "permission_denied")
}
