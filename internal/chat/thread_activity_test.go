package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// A thread reply tells the people in the thread who haven't muted it, as
// one thread_reply entry per thread while unread; mentions and quotes in
// it stay their own items. Its activity item and search hit name the
// thread.
func TestThreadActivity(t *testing.T) {
	pool, _, svc := newTestService(t)
	ada := newUser(t, pool, "ada", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	dot := newUser(t, pool, "dot", authctx.RoleMember)
	sp, err := svc.CreateSpace(ada, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	for _, who := range []context.Context{bea, casey, dot} {
		inv, _ := svc.CreateInvite(ada, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
		if _, err := svc.JoinSpace(who, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
			t.Fatal(err)
		}
	}
	send := func(ctx context.Context, content, threadRoot string) *chatv1.Message {
		t.Helper()
		res, err := svc.SendMessage(ctx, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: content, ThreadRootId: threadRoot}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Message
	}
	items := func(ctx context.Context) []*chatv1.ActivityItem {
		t.Helper()
		res, err := svc.ListActivity(ctx, connect.NewRequest(&chatv1.ListActivityRequest{}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Items
	}
	threadItems := func(ctx context.Context) []*chatv1.ActivityItem {
		t.Helper()
		var out []*chatv1.ActivityItem
		for _, item := range items(ctx) {
			if item.Kind == chatv1.ActivityKind_ACTIVITY_KIND_THREAD_REPLY {
				out = append(out, item)
			}
		}
		return out
	}

	root := send(ada, "@channel who has the ladder?", "")
	first := send(bea, "mine", root.Id)
	got := threadItems(ada)
	if len(got) != 1 || got[0].MessageId != first.Id || got[0].ThreadRootId != root.Id {
		t.Fatalf("ada after bea's reply = %+v, want one thread_reply item naming the thread", got)
	}
	if len(threadItems(bea)) != 0 {
		t.Error("bea was told about her own reply")
	}

	// While ada's entry is unread, casey's reply refreshes it rather than
	// adding one; bea, who replied, gets her first.
	second := send(casey, "I can bring a drill", root.Id)
	if got := threadItems(ada); len(got) != 1 || got[0].MessageId != second.Id {
		t.Errorf("ada after casey's reply = %+v, want her one entry pointing at casey's reply", got)
	}
	if len(threadItems(bea)) != 1 || len(threadItems(casey)) != 0 {
		t.Errorf("after casey's reply: bea %d, casey %d thread items; want 1, 0", len(threadItems(bea)), len(threadItems(casey)))
	}
	if len(items(dot)) != 1 {
		t.Errorf("dot, in only through @channel, has %d items; want just the @channel mention", len(items(dot)))
	}

	// A reply that mentions dot by name is a mention for her, and puts her
	// in the thread: the next reply reaches her as a thread_reply.
	send(casey, "@dot can you hold it steady?", root.Id)
	if got := items(dot); len(got) != 2 || got[0].Kind != chatv1.ActivityKind_ACTIVITY_KIND_MENTION || got[0].ThreadRootId != root.Id {
		t.Errorf("dot after a mention in the thread = %+v, want a mention naming the thread", got)
	}
	send(bea, "saturday then", root.Id)
	if len(threadItems(dot)) != 1 {
		t.Errorf("dot, mentioned by name, has %d thread_reply items; want 1", len(threadItems(dot)))
	}

	// Once read, the next reply starts a new entry.
	if _, err := svc.MarkActivityRead(ada, connect.NewRequest(&chatv1.MarkActivityReadRequest{All: true})); err != nil {
		t.Fatal(err)
	}
	send(bea, "bring snacks", root.Id)
	if got := threadItems(ada); len(got) != 2 || got[0].ReadAt != nil {
		t.Errorf("ada after reading and a new reply = %d thread items, want 2 with the newest unread", len(got))
	}

	// A mute stops the entries; a mention in the muted thread still
	// arrives, marked muted so no banner fires.
	if _, err := svc.SetThreadMuted(ada, connect.NewRequest(&chatv1.SetThreadMutedRequest{MessageId: root.Id, Muted: true})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.MarkActivityRead(ada, connect.NewRequest(&chatv1.MarkActivityReadRequest{All: true})); err != nil {
		t.Fatal(err)
	}
	before := len(items(ada))
	send(bea, "and chairs", root.Id)
	if after := len(items(ada)); after != before {
		t.Errorf("ada muted the thread and got %d new items for a reply", after-before)
	}
	send(bea, "@ada you too", root.Id)
	if got := items(ada); len(got) != before+1 || got[0].Kind != chatv1.ActivityKind_ACTIVITY_KIND_MENTION || !got[0].Muted {
		t.Errorf("ada's newest item = %+v, want a muted mention", got[0])
	}

	// Someone who replied and then left the space hears nothing more.
	if _, err := svc.KickMember(ada, connect.NewRequest(&chatv1.KickMemberRequest{SpaceId: spaceID, UserId: authctx.UserID(casey)})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.MarkActivityRead(casey, connect.NewRequest(&chatv1.MarkActivityReadRequest{All: true})); err != nil {
		t.Fatal(err)
	}
	before = len(items(casey))
	send(bea, "it is in my shed", root.Id)
	if after := len(items(casey)); after != before {
		t.Errorf("casey, kicked, got %d new items for a later reply; want none", after-before)
	}

	found, err := svc.SearchMessages(bea, connect.NewRequest(&chatv1.SearchMessagesRequest{
		Scope: &chatv1.SearchMessagesRequest_SpaceId{SpaceId: spaceID}, Query: "drill",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if hits := found.Msg.Messages; len(hits) != 1 || hits[0].ThreadRootId != root.Id {
		t.Errorf("search for a thread reply = %+v, want one hit naming the thread", hits)
	}
}

// In a DM, a thread reply is one item for the other person, a
// thread_reply, not one and a DM.
func TestThreadActivityInADM(t *testing.T) {
	pool, _, svc := newTestService(t)
	ada := newUser(t, pool, "ada", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	if _, err := pool.Exec(context.Background(), `UPDATE users SET role = 'admin' WHERE id = $1`, authctx.UserID(ada)); err != nil {
		t.Fatal(err)
	}
	ada = authctx.WithIdentity(context.Background(), authctx.Identity{UserID: authctx.UserID(ada), Role: authctx.RoleAdmin})
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
	res, err := svc.ListActivity(ada, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if items := res.Msg.Items; len(items) != 1 || items[0].Kind != chatv1.ActivityKind_ACTIVITY_KIND_THREAD_REPLY {
		t.Errorf("ada's items = %+v, want one thread_reply item", items)
	}
}
