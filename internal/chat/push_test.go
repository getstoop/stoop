package chat_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/events"
)

// What push reads from chat: the names of where an item happened, and
// the recipient's waiting total, the apps' icon count for this server.
func TestPushPortAnswers(t *testing.T) {
	fixture := newAlertsFixture(t)
	ctx := context.Background()
	ada := authctx.UserID(fixture.owner)

	space, channel, err := fixture.svc.PlaceNames(ctx, fixture.channelID)
	if err != nil || space != "Porch" || channel == "" {
		t.Fatalf("PlaceNames = %q, %q, %v", space, channel, err)
	}
	if total, err := fixture.svc.WaitingTotal(ctx, ada); err != nil || total != 0 {
		t.Fatalf("nothing waiting: %d, %v", total, err)
	}

	// Two mentions in the space count two; a conversation with two
	// unread messages counts once.
	fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: mentionOf(fixture.owner) + " one"})
	fixture.send(fixture.cass, &chatv1.SendMessageRequest{Content: mentionOf(fixture.owner) + " two"})
	dm, err := fixture.svc.OpenDirectMessage(fixture.bea, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: []string{ada}}))
	if err != nil {
		t.Fatal(err)
	}
	dmID := dm.Msg.DirectMessage.Channel.Id
	fixture.send(fixture.bea, &chatv1.SendMessageRequest{ChannelId: dmID, Content: "hi"})
	fixture.send(fixture.bea, &chatv1.SendMessageRequest{ChannelId: dmID, Content: "there"})
	if total, err := fixture.svc.WaitingTotal(ctx, ada); err != nil || total != 3 {
		t.Errorf("waiting = %d, %v; want 3", total, err)
	}
	// A muted conversation counts nothing.
	if _, err := fixture.svc.SetChannelMuted(fixture.owner, connect.NewRequest(&chatv1.SetChannelMutedRequest{ChannelId: dmID, Muted: true})); err != nil {
		t.Fatal(err)
	}
	if total, _ := fixture.svc.WaitingTotal(ctx, ada); total != 2 {
		t.Errorf("waiting = %d with the conversation muted, want 2", total)
	}

	space, channel, err = fixture.svc.PlaceNames(ctx, dmID)
	if err != nil || space != "" || channel != "" {
		t.Errorf("a direct message's names = %q, %q, %v", space, channel, err)
	}
	if _, _, err := fixture.svc.PlaceNames(ctx, "0193a5b2-0000-7000-8000-000000000000"); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("an unknown channel: %v", err)
	}
}

// The activity event says whom it is for, so a listener on several
// people's topics can tell.
func TestActivityEventNamesItsRecipient(t *testing.T) {
	pool, bus, svc := newTestService(t)
	ada := newUser(t, pool, "ada", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	space, err := svc.CreateSpace(ada, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	invite, err := svc.CreateInvite(ada, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: space.Msg.Space.Id}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: invite.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	sub := bus.Subscribe(events.UserTopic(authctx.UserID(ada)))
	defer sub.Close()
	if _, err := svc.SendMessage(bea, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: space.Msg.DefaultChannel.Id, Content: mentionOf(ada) + " look",
	})); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(5 * time.Second)
	for {
		select {
		case ev := <-sub.Events():
			if created := ev.GetActivityItemCreated(); created != nil {
				if created.UserId != authctx.UserID(ada) {
					t.Errorf("user_id = %q, want ada", created.UserId)
				}
				return
			}
		case <-deadline:
			t.Fatal("no ActivityItemCreated")
		}
	}
}
