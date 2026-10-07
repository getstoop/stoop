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
