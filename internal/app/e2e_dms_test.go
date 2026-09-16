package app_test

import "testing"

// Closing a conversation (STOOP-249) is one person's list grooming: their
// own row, nobody else's, until the next message puts it back.
func TestE2ECloseConversation(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	ada := h.person("ada")
	stoop, _ := h.space(casey, "The Stoop")
	h.join(ada, h.invite(casey, stoop))
	dm := h.rpc(ada, "stoop.chat.v1.ChatService/OpenDirectMessage", map[string]any{"userIds": []string{h.userID(casey)}}).expect(t, "ok")
	channel := dm.str("directMessage.channel.id")

	closed := func(token string) string {
		for _, d := range h.rpc(token, "stoop.chat.v1.ChatService/ListDirectMessages", map[string]any{}).expect(t, "ok").list("directMessages") {
			if m := d.(map[string]any); m["channel"].(map[string]any)["id"] == channel {
				if m["closed"] == true {
					return "closed"
				}
				return "open"
			}
		}
		return "missing"
	}

	// ada closes it: off her list, still on casey's, still reachable.
	h.rpc(ada, "stoop.chat.v1.ChatService/SetDirectMessageClosed", map[string]any{"channelId": channel, "closed": true}).expect(t, "ok")
	if got := closed(ada); got != "closed" {
		t.Errorf("ada's list after closing: %s", got)
	}
	if got := closed(casey); got != "open" {
		t.Errorf("casey's list after ada closed: %s", got)
	}
	h.list(ada, channel).expect(t, "ok")

	// casey writes: back on ada's list.
	h.send(casey, channel, "still here?").expect(t, "ok")
	if got := closed(ada); got != "open" {
		t.Errorf("ada's list after a message: %s", got)
	}

	// Mute is a separate control: closing does not touch it, and a
	// message reopens a muted conversation too.
	h.rpc(ada, "stoop.chat.v1.ChatService/SetChannelMuted", map[string]any{"channelId": channel, "muted": true}).expect(t, "ok")
	h.rpc(ada, "stoop.chat.v1.ChatService/SetDirectMessageClosed", map[string]any{"channelId": channel, "closed": true}).expect(t, "ok")
	h.send(casey, channel, "one more").expect(t, "ok")
	for _, d := range h.rpc(ada, "stoop.chat.v1.ChatService/ListDirectMessages", map[string]any{}).expect(t, "ok").list("directMessages") {
		if m := d.(map[string]any); m["channel"].(map[string]any)["id"] == channel {
			if m["closed"] == true || m["channel"].(map[string]any)["muted"] != true {
				t.Errorf("after a message to a muted, closed conversation: %v", m)
			}
		}
	}

	// Opening the same person again puts a closed one back.
	h.rpc(ada, "stoop.chat.v1.ChatService/SetDirectMessageClosed", map[string]any{"channelId": channel, "closed": true}).expect(t, "ok")
	h.rpc(ada, "stoop.chat.v1.ChatService/OpenDirectMessage", map[string]any{"userIds": []string{h.userID(casey)}}).expect(t, "ok")
	if got := closed(ada); got != "open" {
		t.Errorf("ada's list after opening again: %s", got)
	}

	// Someone outside the conversation cannot close it.
	bea := h.person("bea")
	h.rpc(bea, "stoop.chat.v1.ChatService/SetDirectMessageClosed", map[string]any{"channelId": channel, "closed": true}).expect(t, "not_found")
}
