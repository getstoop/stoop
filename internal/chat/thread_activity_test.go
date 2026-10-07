package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// A thread reply tells the root's author and earlier repliers, once each,
// and its activity item and search hit name the thread.
func TestThreadActivity(t *testing.T) {
	pool, _, svc := newTestService(t)
	ada := newUser(t, pool, "ada", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	sp, err := svc.CreateSpace(ada, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	for _, who := range []context.Context{bea, casey} {
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

	root := send(ada, "who has the ladder?", "")
	first := send(bea, "mine", root.Id)
	got := items(ada)
	if len(got) != 1 || got[0].Kind != chatv1.ActivityKind_ACTIVITY_KIND_REPLY || got[0].MessageId != first.Id || got[0].ThreadRootId != root.Id {
		t.Fatalf("ada after bea's reply = %+v, want one reply item naming the thread", got)
	}
	if len(items(bea)) != 0 {
		t.Error("bea was told about her own reply")
	}

	// casey's reply tells ada (root author) and bea (earlier replier).
	send(casey, "I can bring a drill", root.Id)
	if len(items(ada)) != 2 || len(items(bea)) != 1 || len(items(casey)) != 0 {
		t.Errorf("after casey's reply: ada %d, bea %d, casey %d items; want 2, 1, 0", len(items(ada)), len(items(bea)), len(items(casey)))
	}

	// A reply that mentions ada is one item for her, a mention.
	send(casey, "@ada saturday?", root.Id)
	adaItems := items(ada)
	if len(adaItems) != 3 || adaItems[0].Kind != chatv1.ActivityKind_ACTIVITY_KIND_MENTION || adaItems[0].ThreadRootId != root.Id {
		t.Errorf("ada after a mention in the thread = %+v, want a third item, a mention naming the thread", adaItems)
	}

	// Someone who replied and then left the space hears nothing more.
	if _, err := svc.KickMember(ada, connect.NewRequest(&chatv1.KickMemberRequest{SpaceId: spaceID, UserId: authctx.UserID(casey)})); err != nil {
		t.Fatal(err)
	}
	before := len(items(casey))
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

// In a DM, a thread reply is one item for the other person, not a reply
// and a DM.
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
	if items := res.Msg.Items; len(items) != 1 || items[0].Kind != chatv1.ActivityKind_ACTIVITY_KIND_REPLY {
		t.Errorf("ada's items = %+v, want one reply item", items)
	}
}
