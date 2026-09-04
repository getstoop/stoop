package chat_test

import (
	"context"
	"reflect"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

func TestMentionsAndActivity(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	cal := newUser(t, pool, "cal", authctx.RoleMember)
	_ = newUser(t, pool, "stranger", authctx.RoleMember) // exists, not a member

	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	inv, _ := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	for _, ctx := range []context.Context{bea, cal} {
		if _, err := svc.JoinSpace(ctx, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
			t.Fatal(err)
		}
	}
	beaEvents := bus.Subscribe("user:" + authctx.UserID(bea))
	defer beaEvents.Close()

	// Owner mentions bea (case-insensitively), themselves, and a non-member.
	res, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: channelID, Content: "hey @Bea and @owner, also @stranger and email@example.com",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{authctx.UserID(bea)}; !reflect.DeepEqual(res.Msg.Message.MentionUserIds, want) {
		t.Errorf("mention_user_ids = %v, want %v (member only, no self, no non-member, no email)", res.Msg.Message.MentionUserIds, want)
	}

	// bea gets an activity item live and on the list; cal gets nothing.
	ev := <-beaEvents.Events()
	nc := ev.GetActivityItemCreated()
	if nc == nil || nc.Item.Actor.Username != "owner" || nc.Item.ChannelId != channelID || nc.Item.Preview == "" {
		t.Fatalf("expected ActivityItemCreated for bea, got %v", ev)
	}
	list, err := svc.ListActivity(bea, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Msg.Items) != 1 || list.Msg.UnreadCount != 1 || list.Msg.Items[0].ReadAt != nil {
		t.Errorf("bea's activity = %+v", list.Msg)
	}
	calList, _ := svc.ListActivity(cal, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if len(calList.Msg.Items) != 0 {
		t.Errorf("cal should have no activity, got %d", len(calList.Msg.Items))
	}

	// ListMessages carries the mentions back.
	msgs, _ := svc.ListMessages(bea, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID}))
	if len(msgs.Msg.Messages) != 1 || len(msgs.Msg.Messages[0].MentionUserIds) != 1 {
		t.Errorf("ListMessages mentions = %+v", msgs.Msg.Messages)
	}

	// Mark read by id, then a second mention and mark-all.
	mr, err := svc.MarkActivityRead(bea, connect.NewRequest(&chatv1.MarkActivityReadRequest{Ids: []string{list.Msg.Items[0].Id}}))
	if err != nil || mr.Msg.UnreadCount != 0 {
		t.Errorf("mark read: %v %v", mr, err)
	}
	if _, err := svc.SendMessage(cal, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "@bea again"})); err != nil {
		t.Fatal(err)
	}
	<-beaEvents.Events()
	list, _ = svc.ListActivity(bea, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if len(list.Msg.Items) != 2 || list.Msg.UnreadCount != 1 {
		t.Errorf("after second mention: %d activity items, %d unread", len(list.Msg.Items), list.Msg.UnreadCount)
	}
	mr, _ = svc.MarkActivityRead(bea, connect.NewRequest(&chatv1.MarkActivityReadRequest{All: true}))
	if mr.Msg.UnreadCount != 0 {
		t.Errorf("mark all: unread = %d", mr.Msg.UnreadCount)
	}
	// Another user's ids are not yours to mark.
	mr, _ = svc.MarkActivityRead(cal, connect.NewRequest(&chatv1.MarkActivityReadRequest{Ids: []string{list.Msg.Items[1].Id}}))
	if mr.Msg.UnreadCount != 0 {
		t.Errorf("cal marking bea's: %v", mr.Msg)
	}
}

func TestMentionEveryone(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	cal := newUser(t, pool, "cal", authctx.RoleMember)
	sp, _ := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	inv, _ := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	for _, ctx := range []context.Context{bea, cal} {
		if _, err := svc.JoinSpace(ctx, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
			t.Fatal(err)
		}
	}

	// Owner: everyone but the author is mentioned and notified.
	res, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "@everyone game night"}))
	if err != nil {
		t.Fatal(err)
	}
	if !res.Msg.Message.MentionsEveryone || len(res.Msg.Message.MentionUserIds) != 2 {
		t.Errorf("owner @everyone: %+v", res.Msg.Message)
	}
	for _, ctx := range []context.Context{bea, cal} {
		l, _ := svc.ListActivity(ctx, connect.NewRequest(&chatv1.ListActivityRequest{}))
		if l.Msg.UnreadCount != 1 {
			t.Errorf("member unread after @everyone = %d", l.Msg.UnreadCount)
		}
	}

	// Member: plain text, nobody notified.
	res, err = svc.SendMessage(bea, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "@everyone ignore me"}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Message.MentionsEveryone || len(res.Msg.Message.MentionUserIds) != 0 {
		t.Errorf("member @everyone should be plain text: %+v", res.Msg.Message)
	}
	l, _ := svc.ListActivity(cal, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if l.Msg.UnreadCount != 1 {
		t.Errorf("cal unread after member's @everyone = %d, want still 1", l.Msg.UnreadCount)
	}

	// ListMessages carries the flag.
	msgs, _ := svc.ListMessages(cal, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID}))
	if !msgs.Msg.Messages[0].MentionsEveryone || msgs.Msg.Messages[1].MentionsEveryone {
		t.Errorf("ListMessages mentions_everyone flags wrong: %+v", msgs.Msg.Messages)
	}
}

type fakePresence []string

func (p fakePresence) OnlineUserIDs(_ context.Context, ids []string) ([]string, error) {
	var out []string
	for _, id := range ids {
		for _, on := range p {
			if id == on {
				out = append(out, id)
			}
		}
	}
	return out, nil
}

func TestMentionHere(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	cal := newUser(t, pool, "cal", authctx.RoleMember)
	sp, _ := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	inv, _ := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	for _, ctx := range []context.Context{bea, cal} {
		if _, err := svc.JoinSpace(ctx, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
			t.Fatal(err)
		}
	}
	// Only bea (and the owner) are online.
	svc.UsePresence(fakePresence{authctx.UserID(owner), authctx.UserID(bea)})

	res, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "@here quick one"}))
	if err != nil {
		t.Fatal(err)
	}
	if !res.Msg.Message.MentionsHere || res.Msg.Message.MentionsEveryone || len(res.Msg.Message.MentionUserIds) != 1 || res.Msg.Message.MentionUserIds[0] != authctx.UserID(bea) {
		t.Errorf("@here: %+v", res.Msg.Message)
	}
	b, _ := svc.ListActivity(bea, connect.NewRequest(&chatv1.ListActivityRequest{}))
	c, _ := svc.ListActivity(cal, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if b.Msg.UnreadCount != 1 || c.Msg.UnreadCount != 0 {
		t.Errorf("@here notified bea=%d cal=%d, want 1/0", b.Msg.UnreadCount, c.Msg.UnreadCount)
	}
	// Member: plain text.
	res, _ = svc.SendMessage(bea, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "@here nope"}))
	if res.Msg.Message.MentionsHere || len(res.Msg.Message.MentionUserIds) != 0 {
		t.Errorf("member @here should be plain: %+v", res.Msg.Message)
	}
}
