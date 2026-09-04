package chat_test

import (
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

func TestEditAndDelete(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	cal := newUser(t, pool, "cal", authctx.RoleMember)
	sp, _ := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	inv, _ := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinSpace(cal, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	sub := bus.Subscribe("space:" + spaceID)
	defer sub.Close()
	drain := func() {
		for {
			select {
			case <-sub.Events():
			default:
				return
			}
		}
	}

	m1, _ := svc.SendMessage(bea, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "helo"}))
	m2, _ := svc.SendMessage(bea, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "second"}))
	drain()

	// Edit: only the author; edited_at set; MessageUpdated broadcast.
	if _, err := svc.EditMessage(cal, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: m1.Msg.Message.Id, Content: "x"})); code(err) != connect.CodePermissionDenied {
		t.Errorf("edit someone else's: want permission_denied, got %v", err)
	}
	if _, err := svc.EditMessage(owner, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: m1.Msg.Message.Id, Content: "x"})); code(err) != connect.CodePermissionDenied {
		t.Errorf("owner editing a member's message: want permission_denied, got %v", err)
	}
	ed, err := svc.EditMessage(bea, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: m1.Msg.Message.Id, Content: "hello"}))
	if err != nil || ed.Msg.Message.Content != "hello" || ed.Msg.Message.EditedAt == nil {
		t.Fatalf("edit own: %v %v", ed, err)
	}
	if ev := (<-sub.Events()).GetMessageUpdated(); ev == nil || ev.Content != "hello" {
		t.Error("expected MessageUpdated event")
	}
	if _, err := svc.EditMessage(bea, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: m1.Msg.Message.Id, Content: ""})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("empty edit: %v", err)
	}

	// Delete: cal can't delete bea's; bea can delete her own; owner can delete anyone's.
	if _, err := svc.DeleteMessage(cal, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: m2.Msg.Message.Id})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member deleting another's: want permission_denied, got %v", err)
	}
	if _, err := svc.DeleteMessage(bea, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: m2.Msg.Message.Id})); err != nil {
		t.Fatalf("delete own: %v", err)
	}
	if ev := (<-sub.Events()).GetMessageDeleted(); ev == nil || ev.MessageId != m2.Msg.Message.Id || ev.SpaceId != spaceID {
		t.Error("expected MessageDeleted event with space_id")
	}
	// The channel's newest message fell back to m1.
	chs, _ := svc.ListChannels(owner, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: spaceID}))
	if chs.Msg.Channels[0].LastMessageId != m1.Msg.Message.Id {
		t.Errorf("last_message_id after delete = %q, want %q", chs.Msg.Channels[0].LastMessageId, m1.Msg.Message.Id)
	}
	// A reply to m1 keeps a quote placeholder after m1 is deleted by the owner.
	rep, _ := svc.SendMessage(cal, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "re", ReplyToMessageId: m1.Msg.Message.Id}))
	if _, err := svc.DeleteMessage(owner, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: m1.Msg.Message.Id})); err != nil {
		t.Fatalf("owner deleting a member's message: %v", err)
	}
	msgs, _ := svc.ListMessages(cal, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID}))
	if len(msgs.Msg.Messages) != 1 || msgs.Msg.Messages[0].Id != rep.Msg.Message.Id {
		t.Fatalf("messages after deletes: %+v", msgs.Msg.Messages)
	}
	if r := msgs.Msg.Messages[0].ReplyTo; r != nil && r.Preview != "" {
		t.Errorf("reply to a deleted message should have no preview: %+v", r)
	}
	if _, err := svc.DeleteMessage(owner, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: m1.Msg.Message.Id})); code(err) != connect.CodeNotFound {
		t.Errorf("deleting twice: want not_found, got %v", err)
	}
}
