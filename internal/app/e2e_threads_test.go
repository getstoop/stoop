package app_test

import (
	"testing"
)

// Threads over the wire: a reply goes under its root, out of the channel's
// history, and a link to it opens the channel around the root with the
// thread named.
func TestE2EThreads(t *testing.T) {
	server := newHarness(t)
	casey := server.person("casey")
	stoop, garden := server.space(casey, "The Stoop")
	ada := server.person("ada")
	server.join(ada, server.invite(casey, stoop))

	root := server.send(casey, garden, "who has the long ladder?").expect(t, "ok").str("message.id")
	reply := server.rpc(ada, "stoop.chat.v1.ChatService/SendMessage", map[string]any{
		"channelId": garden, "content": "mine, in the garage", "threadRootId": root,
	}).expect(t, "ok")
	if reply.str("message.threadRootId") != root {
		t.Errorf("reply threadRootId = %q, want the root", reply.str("message.threadRootId"))
	}
	// A personal token that may post can reply in a thread too.
	server.rpc(server.pat(ada, "messages.post"), "stoop.chat.v1.ChatService/SendMessage", map[string]any{
		"channelId": garden, "content": "after 10", "threadRootId": root,
	}).expect(t, "ok")

	history := server.messages(casey, garden)
	if len(history) != 1 || history[0]["id"] != root {
		t.Fatalf("channel history = %v, want just the root", history)
	}
	thread, _ := history[0]["thread"].(map[string]any)
	if count, _ := thread["replyCount"].(float64); count != 2 {
		t.Errorf("root's thread = %v, want replyCount 2", thread)
	}

	activity := server.rpc(casey, "stoop.chat.v1.ChatService/ListActivity", map[string]any{}).expect(t, "ok")
	if items := activity.list("items"); len(items) == 0 || items[0].(map[string]any)["threadRootId"] != root {
		t.Errorf("casey's activity = %v, want the newest item naming the thread", items)
	}

	page := server.rpc(casey, "stoop.chat.v1.ChatService/ListMessages", map[string]any{"channelId": garden, "threadId": root}).expect(t, "ok")
	if replies := page.list("messages"); len(replies) != 2 {
		t.Errorf("thread page holds %d replies, want 2", len(replies))
	}

	around := server.rpc(casey, "stoop.chat.v1.ChatService/ListMessages", map[string]any{
		"channelId": garden, "aroundId": reply.str("message.id"),
	}).expect(t, "ok")
	if around.str("threadRootId") != root {
		t.Errorf("around a reply: threadRootId = %q, want the root", around.str("threadRootId"))
	}

	server.rpc(ada, "stoop.chat.v1.ChatService/SendMessage", map[string]any{
		"channelId": garden, "content": "x", "threadRootId": reply.str("message.id"),
	}).expect(t, "invalid_argument", "can't start a thread")
}

// Deleting over the wire: a root with replies stays as a placeholder, and
// a moderator's Delete thread takes the root and its replies.
func TestE2EThreadDeletes(t *testing.T) {
	server := newHarness(t)
	casey := server.person("casey")
	stoop, garden := server.space(casey, "The Stoop")
	ada := server.person("ada")
	server.join(ada, server.invite(casey, stoop))

	root := server.send(ada, garden, "who has the long ladder?").expect(t, "ok").str("message.id")
	server.rpc(casey, "stoop.chat.v1.ChatService/SendMessage", map[string]any{
		"channelId": garden, "content": "mine", "threadRootId": root,
	}).expect(t, "ok")

	server.rpc(ada, "stoop.chat.v1.ChatService/DeleteMessage", map[string]any{"messageId": root}).expect(t, "ok")
	history := server.messages(casey, garden)
	if len(history) != 1 || history[0]["deleted"] != true || history[0]["content"] != nil {
		t.Fatalf("channel after deleting the root = %v, want one placeholder", history)
	}
	server.rpc(ada, "stoop.chat.v1.ChatService/DeleteThread", map[string]any{"messageId": root}).expect(t, "permission_denied")
	server.rpc(casey, "stoop.chat.v1.ChatService/DeleteThread", map[string]any{"messageId": root}).expect(t, "ok")
	if history := server.messages(casey, garden); len(history) != 0 {
		t.Errorf("channel after Delete thread = %v, want empty", history)
	}
}

// A bot's token replies in a thread through SendMessage, as the web app
// does (STOOP-437).
func TestE2EBotTokenRepliesInAThread(t *testing.T) {
	server := newHarness(t)
	casey := server.person("casey")
	stoop, general := server.space(casey, "The Stoop")
	bot := server.bot(casey, "deploy")
	server.addBot(casey, bot, stoop)
	token := server.botToken(casey, bot, "space.read", "messages.read", "messages.post")

	rootID := server.send(casey, general, "deploying 2.4 tonight").expect(t, "ok").str("message.id")
	reply := server.rpc(token, "stoop.chat.v1.ChatService/SendMessage", map[string]any{
		"channelId": general, "content": "deploy finished", "threadRootId": rootID,
	}).expect(t, "ok")
	if got := reply.str("message.threadRootId"); got != rootID {
		t.Errorf("the bot's reply names thread %q, want %q", got, rootID)
	}
	also := server.rpc(token, "stoop.chat.v1.ChatService/SendMessage", map[string]any{
		"channelId": general, "content": "rolled back", "threadRootId": rootID, "alsoSendToChannel": true,
	}).expect(t, "ok")
	if also.str("message.threadRoot.messageId") != rootID {
		t.Errorf("an also-sent bot reply = %v, want it to name its thread", also)
	}
}
