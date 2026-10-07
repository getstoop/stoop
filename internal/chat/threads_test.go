package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

func TestThreadReplies(t *testing.T) {
	pool, bus, svc := newTestService(t)
	ada := newUser(t, pool, "ada", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	sp, err := svc.CreateSpace(ada, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	inv, _ := svc.CreateInvite(ada, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	send := func(ctx context.Context, req *chatv1.SendMessageRequest) (*chatv1.Message, error) {
		res, err := svc.SendMessage(ctx, connect.NewRequest(req))
		if err != nil {
			return nil, err
		}
		return res.Msg.Message, nil
	}
	list := func(req *chatv1.ListMessagesRequest) *chatv1.ListMessagesResponse {
		t.Helper()
		res, err := svc.ListMessages(bea, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("ListMessages %+v: %v", req, err)
		}
		return res.Msg
	}
	lastMessage := func() string {
		t.Helper()
		var id string
		if err := pool.QueryRow(context.Background(), `SELECT last_message_id FROM channels WHERE id = $1`, channelID).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}

	root, err := send(ada, &chatv1.SendMessageRequest{ChannelId: channelID, Content: "who has the ladder?"})
	if err != nil {
		t.Fatal(err)
	}
	if !root.InChannel || root.ThreadRootId != "" {
		t.Errorf("root: in_channel=%v thread_root_id=%q", root.InChannel, root.ThreadRootId)
	}

	sub := bus.Subscribe("space:" + spaceID)
	defer sub.Close()
	first, err := send(bea, &chatv1.SendMessageRequest{ChannelId: channelID, Content: "mine, in the garage", ThreadRootId: root.Id})
	if err != nil {
		t.Fatal(err)
	}
	if first.InChannel || first.ThreadRootId != root.Id {
		t.Errorf("reply: in_channel=%v thread_root_id=%q", first.InChannel, first.ThreadRootId)
	}
	if created := nextEvent(t, sub).GetMessageCreated(); created == nil || created.Id != first.Id {
		t.Errorf("first event = %v, want the reply's MessageCreated", created)
	}
	changed := nextEvent(t, sub).GetThreadChanged()
	if changed == nil || changed.RootMessageId != root.Id || changed.Thread.GetReplyCount() != 1 {
		t.Fatalf("second event = %v, want ThreadChanged with one reply", changed)
	}
	if authors := changed.Thread.RecentAuthors; len(authors) != 1 || authors[0].Username != "bea" {
		t.Errorf("recent authors = %v, want [bea]", authors)
	}
	if lastMessage() != root.Id {
		t.Error("a thread reply moved the channel's newest message")
	}
	channels, err := svc.ListChannels(ada, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	for _, listed := range channels.Msg.Channels {
		if listed.Id == channelID && listed.UnreadCount != 0 {
			t.Errorf("ada's unread count after a thread reply = %d, want 0", listed.UnreadCount)
		}
	}

	// A second reply from ada, quoting bea's inside the thread.
	second, err := send(ada, &chatv1.SendMessageRequest{
		ChannelId: channelID, Content: "thanks!", ThreadRootId: root.Id, ReplyToMessageId: first.Id,
	})
	if err != nil {
		t.Fatal(err)
	}

	// The channel shows the root with its summary, and no replies.
	channel := list(&chatv1.ListMessagesRequest{ChannelId: channelID})
	if len(channel.Messages) != 1 || channel.Messages[0].Id != root.Id {
		t.Fatalf("channel page = %d messages, want just the root", len(channel.Messages))
	}
	summary := channel.Messages[0].Thread
	if summary.GetReplyCount() != 2 || summary.LastReplyAt == nil {
		t.Errorf("summary = %+v, want two replies and a last reply time", summary)
	}
	if authors := summary.GetRecentAuthors(); len(authors) != 2 || authors[0].Username != "ada" || authors[1].Username != "bea" {
		t.Errorf("recent authors = %v, want [ada bea]", authors)
	}

	// The thread pages its replies, oldest first, without the root.
	thread := list(&chatv1.ListMessagesRequest{ChannelId: channelID, ThreadId: root.Id})
	if len(thread.Messages) != 2 || thread.Messages[0].Id != first.Id || thread.Messages[1].Id != second.Id {
		t.Fatalf("thread page = %v", thread.Messages)
	}
	if thread.Messages[1].ReplyTo.GetMessageId() != first.Id {
		t.Errorf("quote inside the thread = %v", thread.Messages[1].ReplyTo)
	}
	older := list(&chatv1.ListMessagesRequest{ChannelId: channelID, ThreadId: root.Id, BeforeId: second.Id})
	if len(older.Messages) != 1 || older.Messages[0].Id != first.Id {
		t.Errorf("thread page before the second reply = %v", older.Messages)
	}

	// A link to a reply: the channel opens around its root and names the
	// thread; inside the thread it opens around the reply itself.
	around := list(&chatv1.ListMessagesRequest{ChannelId: channelID, AroundId: second.Id})
	if around.ThreadRootId != root.Id || len(around.Messages) != 1 || around.Messages[0].Id != root.Id {
		t.Errorf("around a reply: thread=%q messages=%v", around.ThreadRootId, around.Messages)
	}
	aroundInThread := list(&chatv1.ListMessagesRequest{ChannelId: channelID, ThreadId: root.Id, AroundId: second.Id})
	if aroundInThread.ThreadRootId != "" || len(aroundInThread.Messages) != 2 {
		t.Errorf("around a reply in its thread: thread=%q messages=%d", aroundInThread.ThreadRootId, len(aroundInThread.Messages))
	}
	if _, err := svc.ListMessages(bea, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID, ThreadId: first.Id})); code(err) != connect.CodeNotFound {
		t.Errorf("paging a reply as a thread: want not_found, got %v", err)
	}
}

func TestThreadRefusals(t *testing.T) {
	pool, _, svc := newTestService(t)
	ada := newUser(t, pool, "ada", authctx.RoleMember)
	sp, err := svc.CreateSpace(ada, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	other, err := svc.CreateChannel(ada, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: spaceID, Name: "other"}))
	if err != nil {
		t.Fatal(err)
	}
	send := func(req *chatv1.SendMessageRequest) (*chatv1.Message, error) {
		res, err := svc.SendMessage(ada, connect.NewRequest(req))
		if err != nil {
			return nil, err
		}
		return res.Msg.Message, nil
	}
	root, err := send(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "root"})
	if err != nil {
		t.Fatal(err)
	}
	reply, err := send(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "reply", ThreadRootId: root.Id})
	if err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name string
		req  *chatv1.SendMessageRequest
		want connect.Code
	}{
		{"root in another channel", &chatv1.SendMessageRequest{ChannelId: other.Msg.Channel.Id, Content: "x", ThreadRootId: root.Id}, connect.CodeInvalidArgument},
		{"a reply as a root", &chatv1.SendMessageRequest{ChannelId: channelID, Content: "x", ThreadRootId: reply.Id}, connect.CodeInvalidArgument},
		{"unknown root", &chatv1.SendMessageRequest{ChannelId: channelID, Content: "x", ThreadRootId: "00000000-0000-7000-8000-000000000000"}, connect.CodeNotFound},
		{"channel message quoting a thread reply", &chatv1.SendMessageRequest{ChannelId: channelID, Content: "x", ReplyToMessageId: reply.Id}, connect.CodeInvalidArgument},
	} {
		if _, err := send(tc.req); code(err) != tc.want {
			t.Errorf("%s: want %v, got %v", tc.name, tc.want, err)
		}
	}

	second, err := send(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "another root"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := send(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "x", ThreadRootId: root.Id, ReplyToMessageId: second.Id}); code(err) != connect.CodeInvalidArgument {
		t.Errorf("thread reply quoting another thread's root: want invalid_argument, got %v", err)
	}
	if _, err := send(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "x", ThreadRootId: root.Id, ReplyToMessageId: root.Id}); err != nil {
		t.Errorf("thread reply quoting its root: %v", err)
	}

	if _, err := svc.SetMessagePinned(ada, connect.NewRequest(&chatv1.SetMessagePinnedRequest{MessageId: reply.Id, Pinned: true})); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("pinning a thread reply: want failed_precondition, got %v", err)
	}

	// Announcement channels have no threads, for admins too.
	policy := chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS
	if _, err := svc.UpdateChannel(ada, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: channelID, PostPolicy: &policy})); err != nil {
		t.Fatal(err)
	}
	if _, err := send(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "x", ThreadRootId: root.Id}); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("thread reply in an announcement channel: want failed_precondition, got %v", err)
	}
	if _, err := svc.ListMessages(ada, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID, ThreadId: root.Id})); err != nil {
		t.Errorf("reading an existing thread in an announcement channel: %v", err)
	}
}

// A thread reply in a DM leaves the conversation's unread count alone.
func TestThreadReplyLeavesDMUnreadAlone(t *testing.T) {
	pool, _, svc := newTestService(t)
	ada := newUser(t, pool, "ada", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	sp, err := svc.CreateSpace(ada, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	inv, _ := svc.CreateInvite(ada, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: sp.Msg.Space.Id}))
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	dm, err := svc.OpenDirectMessage(ada, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: []string{authctx.UserID(bea)}}))
	if err != nil {
		t.Fatal(err)
	}
	channelID := dm.Msg.DirectMessage.Channel.Id
	root, err := svc.SendMessage(ada, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "root"}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendMessage(bea, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "reply", ThreadRootId: root.Msg.Message.Id})); err != nil {
		t.Fatal(err)
	}
	dms, err := svc.ListDirectMessages(ada, connect.NewRequest(&chatv1.ListDirectMessagesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if listed := dms.Msg.DirectMessages; len(listed) != 1 || listed[0].Channel.UnreadCount != 0 {
		t.Errorf("ada's DM unread count after a thread reply = %+v, want 0", listed)
	}
}
