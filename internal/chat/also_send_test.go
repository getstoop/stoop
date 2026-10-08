package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// A reply also sent to the channel is one message in both timelines: it
// moves the channel's newest message, names its thread's root, and its
// delete puts the channel back (STOOP-436).
func TestAlsoSendToChannel(t *testing.T) {
	pool, _, svc := newTestService(t)
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
		req.ChannelId = channelID
		res, err := svc.SendMessage(ctx, connect.NewRequest(req))
		if err != nil {
			return nil, err
		}
		return res.Msg.Message, nil
	}
	list := func(req *chatv1.ListMessagesRequest) *chatv1.ListMessagesResponse {
		t.Helper()
		req.ChannelId = channelID
		res, err := svc.ListMessages(ada, connect.NewRequest(req))
		if err != nil {
			t.Fatal(err)
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
	unreadFor := func(ctx context.Context) bool {
		t.Helper()
		res, err := svc.ListChannels(ctx, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: spaceID}))
		if err != nil {
			t.Fatal(err)
		}
		for _, channel := range res.Msg.Channels {
			if channel.Id == channelID {
				return channel.UnreadCount > 0
			}
		}
		t.Fatal("channel not listed")
		return false
	}

	if _, err := send(bea, &chatv1.SendMessageRequest{Content: "hi", AlsoSendToChannel: true}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("also send with no thread: %v, want InvalidArgument", err)
	}

	root, err := send(ada, &chatv1.SendMessageRequest{Content: "who has the ladder?"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.MarkChannelRead(ada, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: channelID})); err != nil {
		t.Fatal(err)
	}
	reply, err := send(bea, &chatv1.SendMessageRequest{Content: "mine, everyone can borrow it", ThreadRootId: root.Id, AlsoSendToChannel: true})
	if err != nil {
		t.Fatal(err)
	}
	if !reply.InChannel || reply.ThreadRootId != root.Id {
		t.Errorf("reply: in_channel=%v thread_root_id=%q", reply.InChannel, reply.ThreadRootId)
	}
	if ref := reply.ThreadRoot; ref.GetMessageId() != root.Id || ref.GetAuthor().GetUsername() != "ada" || ref.GetPreview() != "who has the ladder?" {
		t.Errorf("thread_root on the sent reply = %+v", ref)
	}
	if lastMessage() != reply.Id {
		t.Error("an also-sent reply didn't move the channel's newest message")
	}
	if !unreadFor(ada) || unreadFor(bea) {
		t.Errorf("unread: ada %v (want true), bea %v (want false, she sent it)", unreadFor(ada), unreadFor(bea))
	}

	channel := list(&chatv1.ListMessagesRequest{})
	if got := len(channel.Messages); got != 2 || channel.Messages[1].Id != reply.Id {
		t.Fatalf("channel lists %d messages, want the root and the reply", got)
	}
	if ref := channel.Messages[1].ThreadRoot; ref.GetAuthor().GetUsername() != "ada" {
		t.Errorf("listed reply's thread_root = %+v", ref)
	}
	if summary := channel.Messages[0].Thread; summary.GetReplyCount() != 1 {
		t.Errorf("root's summary = %+v, want one reply", summary)
	}
	if thread := list(&chatv1.ListMessagesRequest{ThreadId: root.Id}); len(thread.Messages) != 1 || thread.Messages[0].Id != reply.Id {
		t.Errorf("thread lists %v, want the reply", thread.Messages)
	}
	around := list(&chatv1.ListMessagesRequest{AroundId: reply.Id})
	if around.ThreadRootId != "" || len(around.Messages) != 2 {
		t.Errorf("around the reply: thread_root_id=%q, %d messages; want the channel itself", around.ThreadRootId, len(around.Messages))
	}

	// With its root a placeholder, the line keeps only the root's id.
	if _, err := svc.DeleteMessage(ada, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: root.Id})); err != nil {
		t.Fatal(err)
	}
	listed := list(&chatv1.ListMessagesRequest{}).Messages
	if ref := listed[len(listed)-1].ThreadRoot; ref.GetMessageId() != root.Id || ref.GetAuthor() != nil || ref.GetPreview() != "" {
		t.Errorf("thread_root under a placeholder = %+v, want the id alone", ref)
	}

	// Deleting the reply takes the placeholder with it and hands the
	// channel back.
	if _, err := send(ada, &chatv1.SendMessageRequest{Content: "thanks", ThreadRootId: root.Id, AlsoSendToChannel: true}); err == nil {
		t.Fatal("replied under a placeholder")
	}
	if _, err := svc.DeleteMessage(bea, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: reply.Id})); err != nil {
		t.Fatal(err)
	}
	var last *string
	if err := pool.QueryRow(context.Background(), `SELECT last_message_id FROM channels WHERE id = $1`, channelID).Scan(&last); err != nil {
		t.Fatal(err)
	}
	if last != nil {
		t.Errorf("channel's newest message = %v after its only messages went, want none", *last)
	}
}
