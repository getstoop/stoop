package chat_test

import (
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// A coalescing entry refreshed by a later message takes a new id, so it
// sorts as new in a feed ordered by id (messaging.md → The DM feed
// collapses): the event carries the new id, the list has the entry once
// and first, the old id is gone, and the unread count is unchanged. A
// client still holding the old id reads nothing with it, and loses
// nothing: the entry is read on the next tap or by the marker.
func TestRefreshedEntryIsNew(t *testing.T) {
	fx := newReadActivityFixture(t)
	sub := fx.bus.Subscribe("user:" + authctx.UserID(fx.ada))
	defer sub.Close()
	list := func() *chatv1.ListActivityResponse {
		t.Helper()
		res, err := fx.svc.ListActivity(fx.ada, connect.NewRequest(&chatv1.ListActivityRequest{}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg
	}
	// checkRefresh is what a refresh under a new id looks like from
	// ada's side: the event's item against the entry it replaced, the
	// message it should point at, and the unread count before it.
	checkRefresh := func(what string, old, refreshed *chatv1.ActivityItem, message *chatv1.Message, unreadBefore int32) {
		t.Helper()
		if refreshed.Id <= old.Id || refreshed.Kind != old.Kind || refreshed.ChannelId != old.ChannelId || refreshed.MessageId != message.Id || refreshed.ReadAt != nil {
			t.Fatalf("%s: event = %+v, want an unread %v at %s with an id after %s", what, refreshed, old.Kind, message.Id, old.Id)
		}
		feed := list()
		if len(feed.Items) == 0 || feed.Items[0].Id != refreshed.Id || feed.Items[0].MessageId != message.Id {
			t.Errorf("%s: feed starts with %+v, want the refreshed entry at %s", what, feed.Items, message.Id)
		}
		ofKind := 0
		for _, item := range feed.Items {
			if item.Id == old.Id {
				t.Errorf("%s: the old id %s is still listed", what, old.Id)
			}
			if item.Kind == old.Kind && item.ChannelId == old.ChannelId && item.ThreadRootId == old.ThreadRootId {
				ofKind++
			}
		}
		if ofKind != 1 {
			t.Errorf("%s: %d entries for the conversation or thread, want 1", what, ofKind)
		}
		if feed.UnreadCount != unreadBefore {
			t.Errorf("%s: unread_count %d after the refresh, want %d as before", what, feed.UnreadCount, unreadBefore)
		}
	}

	// A direct message, with a mention arriving between its two messages
	// so the refreshed entry has to climb past it.
	opened, err := fx.svc.OpenDirectMessage(fx.bea, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: []string{authctx.UserID(fx.ada)}}))
	if err != nil {
		t.Fatal(err)
	}
	dmID := opened.Msg.DirectMessage.Channel.Id
	fx.send(fx.bea, &chatv1.SendMessageRequest{ChannelId: dmID, Content: "hey"})
	first := nextActivityItem(t, sub).Item
	fx.send(fx.casey, &chatv1.SendMessageRequest{Content: mentionOf(fx.ada) + " look"})
	nextActivityItem(t, sub)
	if feed := list(); feed.UnreadCount != 2 || feed.Items[0].Kind != chatv1.ActivityKind_ACTIVITY_KIND_MENTION {
		t.Fatalf("before the refresh: %d unread, newest %v; want 2 with the mention newest", feed.UnreadCount, feed.Items[0].Kind)
	}
	second := fx.send(fx.bea, &chatv1.SendMessageRequest{ChannelId: dmID, Content: "you there?"})
	refreshed := nextActivityItem(t, sub).Item
	checkRefresh("dm", first, refreshed, second, 2)

	// The stale id reads nothing.
	read, err := fx.svc.MarkActivityRead(fx.ada, connect.NewRequest(&chatv1.MarkActivityReadRequest{Ids: []string{first.Id}}))
	if err != nil {
		t.Fatal(err)
	}
	if read.Msg.UnreadCount != 2 {
		t.Errorf("reading the old id: unread_count %d, want 2", read.Msg.UnreadCount)
	}
	if feed := list(); feed.Items[0].Id != refreshed.Id || feed.Items[0].ReadAt != nil {
		t.Errorf("reading the old id: newest = %+v, want the refreshed entry still unread", feed.Items[0])
	}

	// A thread, the same way.
	root := fx.send(fx.ada, &chatv1.SendMessageRequest{Content: "a thread"})
	fx.send(fx.bea, &chatv1.SendMessageRequest{Content: "mine", ThreadRootId: root.Id})
	threadFirst := nextActivityItem(t, sub).Item
	if threadFirst.Kind != chatv1.ActivityKind_ACTIVITY_KIND_THREAD_REPLY || threadFirst.ThreadRootId != root.Id {
		t.Fatalf("bea's reply = %+v, want a thread_reply naming the thread", threadFirst)
	}
	fx.send(fx.casey, &chatv1.SendMessageRequest{Content: mentionOf(fx.ada) + " again"})
	nextActivityItem(t, sub)
	// Posting the root moved ada's channel marker past casey's first
	// mention, so the count is read rather than reckoned.
	before := list().UnreadCount
	reply := fx.send(fx.bea, &chatv1.SendMessageRequest{Content: "still mine", ThreadRootId: root.Id})
	threadRefreshed := nextActivityItem(t, sub).Item
	checkRefresh("thread_reply", threadFirst, threadRefreshed, reply, before)
	if threadRefreshed.ThreadRootId != root.Id {
		t.Errorf("refreshed thread_reply names thread %q, want %s", threadRefreshed.ThreadRootId, root.Id)
	}
}
