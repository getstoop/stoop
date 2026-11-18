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

// An item stays pending for push until it is read, replaced by a newer
// one, deleted with its message, or muted; it is only its recipient's.
func TestActivityPending(t *testing.T) {
	fixture := newAlertsFixture(t)
	ctx := context.Background()
	ada := authctx.UserID(fixture.owner)
	itemFor := func(messageID string) string {
		t.Helper()
		var id string
		if err := fixture.pool.QueryRow(ctx,
			`SELECT id FROM activity_items WHERE user_id = $1 AND message_id = $2`, ada, messageID).Scan(&id); err != nil {
			return ""
		}
		return id
	}
	pendingFor := func(userID, itemID string) bool {
		t.Helper()
		ok, err := fixture.svc.ActivityPending(ctx, userID, itemID, "")
		if err != nil {
			t.Fatal(err)
		}
		return ok
	}

	first := fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: mentionOf(fixture.owner) + " one"})
	mention := itemFor(first.Id)
	if mention == "" || !pendingFor(ada, mention) {
		t.Fatal("a fresh mention is not pending")
	}
	if pendingFor(authctx.UserID(fixture.bea), mention) {
		t.Error("someone else's item reads as pending")
	}
	if _, err := fixture.svc.MarkActivityRead(fixture.owner, connect.NewRequest(&chatv1.MarkActivityReadRequest{Ids: []string{mention}})); err != nil {
		t.Fatal(err)
	}
	if pendingFor(ada, mention) {
		t.Error("a read mention is still pending")
	}
	second := fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: mentionOf(fixture.owner) + " two"})
	deleted := itemFor(second.Id)
	if _, err := fixture.svc.DeleteMessage(fixture.bea, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: second.Id})); err != nil {
		t.Fatal(err)
	}
	if deleted == "" || pendingFor(ada, deleted) {
		t.Error("a deleted message's mention is still pending")
	}

	// A conversation's newer message refreshes its entry under a new id:
	// the older one is no longer pending, so its retry sends nothing.
	dm, err := fixture.svc.OpenDirectMessage(fixture.bea, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: []string{ada}}))
	if err != nil {
		t.Fatal(err)
	}
	dmID := dm.Msg.DirectMessage.Channel.Id
	older := itemFor(fixture.send(fixture.bea, &chatv1.SendMessageRequest{ChannelId: dmID, Content: "hi"}).Id)
	newer := itemFor(fixture.send(fixture.bea, &chatv1.SendMessageRequest{ChannelId: dmID, Content: "there"}).Id)
	if newer == "" || older == newer || pendingFor(ada, older) || !pendingFor(ada, newer) {
		t.Errorf("older %q, newer %q: the newer alone should be pending", older, newer)
	}
	if _, err := fixture.svc.SetChannelMuted(fixture.owner, connect.NewRequest(&chatv1.SetChannelMutedRequest{ChannelId: dmID, Muted: true})); err != nil {
		t.Fatal(err)
	}
	if pendingFor(ada, newer) {
		t.Error("an item muted since is still pending")
	}
}
