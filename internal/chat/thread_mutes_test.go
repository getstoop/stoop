package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/events"
)

// Who is in a thread, its new-reply count per person, read markers, and
// mutes (STOOP-433).
func TestThreadMutesAndReads(t *testing.T) {
	pool, bus, svc := newTestService(t)
	ada := newUser(t, pool, "ada", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	cara := newUser(t, pool, "cara", authctx.RoleMember)
	dot := newUser(t, pool, "dot", authctx.RoleMember)
	sp, err := svc.CreateSpace(ada, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	inv, _ := svc.CreateInvite(ada, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	for _, member := range []context.Context{bea, cara, dot} {
		if _, err := svc.JoinSpace(member, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
			t.Fatal(err)
		}
	}
	send := func(ctx context.Context, content, rootID string) *chatv1.Message {
		t.Helper()
		res, err := svc.SendMessage(ctx, connect.NewRequest(&chatv1.SendMessageRequest{
			ChannelId: channelID, Content: content, ThreadRootId: rootID,
		}))
		if err != nil {
			t.Fatalf("send %q: %v", content, err)
		}
		return res.Msg.Message
	}
	// summary is the root's thread summary as one person's page shows it.
	summary := func(ctx context.Context, rootID string) *chatv1.ThreadSummary {
		t.Helper()
		res, err := svc.ListMessages(ctx, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID}))
		if err != nil {
			t.Fatal(err)
		}
		for _, message := range res.Msg.Messages {
			if message.Id == rootID {
				return message.Thread
			}
		}
		t.Fatalf("root %s not on the page", rootID)
		return nil
	}
	expect := func(who string, ctx context.Context, rootID string, participating, muted bool, unread int32) {
		t.Helper()
		got := summary(ctx, rootID)
		if got.Participating != participating || got.Muted != muted || got.UnreadCount != unread {
			t.Errorf("%s sees participating=%v muted=%v unread=%d, want %v %v %d",
				who, got.Participating, got.Muted, got.UnreadCount, participating, muted, unread)
		}
	}

	root := send(ada, "@everyone who has the ladder?", "")
	send(bea, "mine, in the garage", root.Id)
	beaSecond := send(bea, "@cara you borrowed it last", root.Id)

	expect("ada (started it)", ada, root.Id, true, false, 2)
	expect("bea (replied)", bea, root.Id, true, false, 0)
	expect("cara (named)", cara, root.Id, true, false, 2)
	expect("dot (only @everyone)", dot, root.Id, false, false, 0)

	// Reading moves forward only, to the newest reply or a named one.
	sub := bus.Subscribe(events.UserTopic(authctx.UserID(ada)))
	defer sub.Close()
	read, err := svc.MarkThreadRead(ada, connect.NewRequest(&chatv1.MarkThreadReadRequest{MessageId: root.Id}))
	if err != nil {
		t.Fatal(err)
	}
	if read.Msg.LastReadMessageId != beaSecond.Id {
		t.Errorf("marker = %s, want the newest reply", read.Msg.LastReadMessageId)
	}
	if ev := nextEvent(t, sub).GetThreadRead(); ev == nil || ev.RootMessageId != root.Id || ev.LastReadMessageId != beaSecond.Id {
		t.Errorf("ThreadRead event = %v", ev)
	}
	expect("ada after reading", ada, root.Id, true, false, 0)
	back, err := svc.MarkThreadRead(cara, connect.NewRequest(&chatv1.MarkThreadReadRequest{MessageId: root.Id, ReplyId: beaSecond.Id}))
	if err != nil {
		t.Fatal(err)
	}
	if back.Msg.LastReadMessageId != beaSecond.Id {
		t.Errorf("cara's marker = %s", back.Msg.LastReadMessageId)
	}

	// Replying reads the thread up to your own reply.
	send(cara, "it's back in the garage", root.Id)
	expect("ada after cara replies", ada, root.Id, true, false, 1)
	expect("cara after replying", cara, root.Id, true, false, 0)

	// A mute hides the count and stays through a reply.
	if _, err := svc.SetThreadMuted(ada, connect.NewRequest(&chatv1.SetThreadMutedRequest{MessageId: root.Id, Muted: true})); err != nil {
		t.Fatal(err)
	}
	var muted *realtimev1.ThreadMuted
	for muted == nil { // replies before it tell ada about them on the same topic
		muted = nextEvent(t, sub).GetThreadMuted()
	}
	if ev := muted; !ev.Muted || ev.RootMessageId != root.Id {
		t.Errorf("ThreadMuted event = %v", ev)
	}
	send(ada, "thanks all", root.Id)
	send(bea, "any time", root.Id)
	expect("ada muted", ada, root.Id, true, true, 0)

	mutes, err := svc.ListThreadMutes(ada, connect.NewRequest(&chatv1.ListThreadMutesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if got := mutes.Msg.Threads; len(got) != 1 || got[0].Root.GetId() != root.Id || got[0].SpaceId != spaceID || got[0].ChannelId != channelID {
		t.Errorf("ListThreadMutes = %v, want the one thread", got)
	}

	if _, err := svc.SetThreadMuted(ada, connect.NewRequest(&chatv1.SetThreadMutedRequest{MessageId: root.Id})); err != nil {
		t.Fatal(err)
	}
	expect("ada unmuted", ada, root.Id, true, false, 1)

	// Refusals: a reply is not a root, a reply from another thread can't
	// be a marker, and an outsider learns nothing.
	other := send(ada, "another question", "")
	otherReply := send(bea, "another answer", other.Id)
	if _, err := svc.SetThreadMuted(ada, connect.NewRequest(&chatv1.SetThreadMutedRequest{MessageId: otherReply.Id, Muted: true})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("muting a reply: %v, want InvalidArgument", err)
	}
	if _, err := svc.MarkThreadRead(ada, connect.NewRequest(&chatv1.MarkThreadReadRequest{MessageId: root.Id, ReplyId: otherReply.Id})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("marking with another thread's reply: %v, want InvalidArgument", err)
	}
	outsider := newUser(t, pool, "eve", authctx.RoleMember)
	if _, err := svc.SetThreadMuted(outsider, connect.NewRequest(&chatv1.SetThreadMutedRequest{MessageId: root.Id, Muted: true})); err == nil {
		t.Error("an outsider muted a thread")
	}

	// A thread in a space you left drops off your list.
	if _, err := svc.SetThreadMuted(bea, connect.NewRequest(&chatv1.SetThreadMutedRequest{MessageId: root.Id, Muted: true})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.LeaveSpace(bea, connect.NewRequest(&chatv1.LeaveSpaceRequest{SpaceId: spaceID})); err != nil {
		t.Fatal(err)
	}
	left, err := svc.ListThreadMutes(bea, connect.NewRequest(&chatv1.ListThreadMutesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(left.Msg.Threads) != 0 {
		t.Errorf("bea still lists %d muted threads after leaving", len(left.Msg.Threads))
	}
}
