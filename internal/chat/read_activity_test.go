package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
)

// readActivityFixture is a space of ada, bea and casey, for what moving a
// read marker does to activity.
type readActivityFixture struct {
	t         *testing.T
	svc       *chat.Service
	channelID string
	ada, bea  context.Context
	casey     context.Context
}

func newReadActivityFixture(t *testing.T) *readActivityFixture {
	t.Helper()
	pool, _, svc := newTestService(t)
	fx := &readActivityFixture{
		t: t, svc: svc,
		ada:   newUser(t, pool, "ada", authctx.RoleMember),
		bea:   newUser(t, pool, "bea", authctx.RoleMember),
		casey: newUser(t, pool, "casey", authctx.RoleMember),
	}
	sp, err := svc.CreateSpace(fx.ada, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	fx.channelID = sp.Msg.DefaultChannel.Id
	for _, who := range []context.Context{fx.bea, fx.casey} {
		inv, _ := svc.CreateInvite(fx.ada, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: sp.Msg.Space.Id}))
		if _, err := svc.JoinSpace(who, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
			t.Fatal(err)
		}
	}
	return fx
}

func (fx *readActivityFixture) send(ctx context.Context, req *chatv1.SendMessageRequest) *chatv1.Message {
	fx.t.Helper()
	req.ChannelId = fx.channelID
	res, err := fx.svc.SendMessage(ctx, connect.NewRequest(req))
	if err != nil {
		fx.t.Fatal(err)
	}
	return res.Msg.Message
}

// unread is the person's unread items by the message each is about, and
// the server's unread count, which reaches past the first page.
func (fx *readActivityFixture) unread(ctx context.Context) (map[string]chatv1.ActivityKind, int32) {
	fx.t.Helper()
	res, err := fx.svc.ListActivity(ctx, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if err != nil {
		fx.t.Fatal(err)
	}
	out := map[string]chatv1.ActivityKind{}
	for _, item := range res.Msg.Items {
		if item.ReadAt == nil {
			out[item.MessageId] = item.Kind
		}
	}
	return out, res.Msg.UnreadCount
}

func (fx *readActivityFixture) readChannel(ctx context.Context, messageID string) {
	fx.t.Helper()
	if _, err := fx.svc.MarkChannelRead(ctx, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: fx.channelID, MessageId: messageID})); err != nil {
		fx.t.Fatal(err)
	}
}

func (fx *readActivityFixture) readThread(ctx context.Context, rootID, replyID string) {
	fx.t.Helper()
	if _, err := fx.svc.MarkThreadRead(ctx, connect.NewRequest(&chatv1.MarkThreadReadRequest{MessageId: rootID, ReplyId: replyID})); err != nil {
		fx.t.Fatal(err)
	}
}

// The channel read marker reads the mentions and replies it passes, and
// only the reader's: the rest stay unread until the marker reaches them.
func TestChannelReadClearsActivity(t *testing.T) {
	fx := newReadActivityFixture(t)
	mine := fx.send(fx.ada, &chatv1.SendMessageRequest{Content: "anyone got a ladder?"})
	first := fx.send(fx.bea, &chatv1.SendMessageRequest{Content: mentionOf(fx.ada) + " " + mentionOf(fx.casey) + " me"})
	reply := fx.send(fx.bea, &chatv1.SendMessageRequest{Content: "here", ReplyToMessageId: mine.Id})
	last := fx.send(fx.bea, &chatv1.SendMessageRequest{Content: mentionOf(fx.ada) + " saturday?"})
	if got, _ := fx.unread(fx.ada); len(got) != 3 || got[reply.Id] != chatv1.ActivityKind_ACTIVITY_KIND_REPLY {
		t.Fatalf("ada before reading = %v, want two mentions and a reply", got)
	}

	fx.readChannel(fx.ada, reply.Id)
	got, count := fx.unread(fx.ada)
	if len(got) != 1 || count != 1 {
		t.Errorf("ada read up to the reply: unread %v (count %d), want only the later mention", got, count)
	}
	if _, ok := got[last.Id]; !ok {
		t.Errorf("the mention after the marker was read: %v", got)
	}
	if got, _ := fx.unread(fx.casey); len(got) != 1 {
		t.Errorf("casey's mention went with ada's read: unread %v", got)
	} else if _, ok := got[first.Id]; !ok {
		t.Errorf("casey's unread = %v, want her mention", got)
	}

	// An older target leaves the marker where it was, and clears against
	// where it is.
	fx.readChannel(fx.ada, first.Id)
	if got, _ := fx.unread(fx.ada); len(got) != 1 {
		t.Errorf("an older read changed ada's unread to %v", got)
	}
	fx.readChannel(fx.ada, "")
	if got, count := fx.unread(fx.ada); len(got) != 0 || count != 0 {
		t.Errorf("ada read the channel to its end: unread %v (count %d), want none", got, count)
	}
}

// Sending moves the author's marker to their message, and reads what it
// passes, as opening the channel would.
func TestSendingClearsActivity(t *testing.T) {
	fx := newReadActivityFixture(t)
	fx.send(fx.bea, &chatv1.SendMessageRequest{Content: mentionOf(fx.ada) + " ladder?"})
	root := fx.send(fx.bea, &chatv1.SendMessageRequest{Content: "drills"})
	inThread := fx.send(fx.bea, &chatv1.SendMessageRequest{Content: mentionOf(fx.ada) + " yours?", ThreadRootId: root.Id})

	// A reply in the thread reads the thread, not the channel.
	fx.send(fx.ada, &chatv1.SendMessageRequest{Content: "yes", ThreadRootId: root.Id})
	got, _ := fx.unread(fx.ada)
	if _, ok := got[inThread.Id]; ok || len(got) != 1 {
		t.Errorf("ada replied in the thread: unread %v, want only the channel mention", got)
	}
	fx.send(fx.ada, &chatv1.SendMessageRequest{Content: "on my way"})
	if got, _ := fx.unread(fx.ada); len(got) != 0 {
		t.Errorf("ada wrote in the channel: unread %v, want none", got)
	}
}

// The channel's marker leaves a thread's items to the thread's marker,
// except a mention in a reply also sent to the channel, which the
// channel shows. A thread's marker reads its own thread and no other.
func TestThreadReadClearsActivity(t *testing.T) {
	fx := newReadActivityFixture(t)
	rootA := fx.send(fx.ada, &chatv1.SendMessageRequest{Content: "ladder"})
	rootB := fx.send(fx.ada, &chatv1.SendMessageRequest{Content: "drill"})
	replyA := fx.send(fx.bea, &chatv1.SendMessageRequest{Content: "mine", ThreadRootId: rootA.Id})
	mentionA := fx.send(fx.bea, &chatv1.SendMessageRequest{Content: mentionOf(fx.ada) + " come get it", ThreadRootId: rootA.Id})
	mentionB := fx.send(fx.bea, &chatv1.SendMessageRequest{Content: mentionOf(fx.ada) + " borrow it", ThreadRootId: rootB.Id})
	alsoSent := fx.send(fx.bea, &chatv1.SendMessageRequest{Content: mentionOf(fx.ada) + " it's on the porch", ThreadRootId: rootB.Id, AlsoSendToChannel: true})
	// Thread A: a thread_reply item for bea's reply and a mention; thread
	// B: two mentions, the second also in the channel.
	got, _ := fx.unread(fx.ada)
	if len(got) != 4 || got[replyA.Id] != chatv1.ActivityKind_ACTIVITY_KIND_THREAD_REPLY {
		t.Fatalf("ada before reading = %v, want a thread_reply item and three mentions", got)
	}

	fx.readChannel(fx.ada, "")
	got, _ = fx.unread(fx.ada)
	if _, ok := got[alsoSent.Id]; ok {
		t.Errorf("the mention also sent to the channel stayed unread after reading the channel")
	}
	if len(got) != 3 {
		t.Errorf("ada read the channel: unread %v, want thread A's two items and thread B's first mention", got)
	}

	fx.readThread(fx.ada, rootA.Id, "")
	got, _ = fx.unread(fx.ada)
	if _, ok := got[mentionA.Id]; ok {
		t.Errorf("ada read thread A and its mention stayed unread")
	}
	if _, ok := got[mentionB.Id]; !ok || len(got) != 1 {
		t.Errorf("ada read thread A: unread %v, want thread B's mention alone", got)
	}

	// A thread_reply item clears at the thread's marker, not before it.
	fx.send(fx.casey, &chatv1.SendMessageRequest{Content: "me too", ThreadRootId: rootA.Id})
	later := fx.send(fx.casey, &chatv1.SendMessageRequest{Content: "and me", ThreadRootId: rootA.Id})
	if got, _ := fx.unread(fx.ada); got[later.Id] != chatv1.ActivityKind_ACTIVITY_KIND_THREAD_REPLY {
		t.Fatalf("ada after casey's replies = %v, want a thread_reply item at the newest", got)
	}
	fx.readChannel(fx.ada, "")
	if got, _ := fx.unread(fx.ada); got[later.Id] != chatv1.ActivityKind_ACTIVITY_KIND_THREAD_REPLY {
		t.Errorf("reading the channel read thread A's thread_reply item")
	}
	fx.readThread(fx.ada, rootA.Id, "")
	if got, _ := fx.unread(fx.ada); len(got) != 1 {
		t.Errorf("ada read thread A again: unread %v, want thread B's mention alone", got)
	}
}

// Every unread item the marker passes clears, however far past the
// feed's first page it sits.
func TestChannelReadClearsBeyondFirstPage(t *testing.T) {
	fx := newReadActivityFixture(t)
	const sent = 60
	for range sent {
		fx.send(fx.bea, &chatv1.SendMessageRequest{Content: mentionOf(fx.ada) + " ping"})
	}
	if _, count := fx.unread(fx.ada); count != sent {
		t.Fatalf("ada has %d unread, want %d", count, sent)
	}
	fx.readChannel(fx.ada, "")
	if _, count := fx.unread(fx.ada); count != 0 {
		t.Errorf("ada read the channel and has %d unread, want 0", count)
	}
}
