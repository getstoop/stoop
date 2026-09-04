package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

func TestReplies(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	sp, _ := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	inv, _ := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	other, _ := svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: spaceID, Name: "other"}))
	unread := func(ctx context.Context) (int32, chatv1.ActivityKind) {
		l, _ := svc.ListActivity(ctx, connect.NewRequest(&chatv1.ListActivityRequest{}))
		if len(l.Msg.Items) == 0 {
			return l.Msg.UnreadCount, 0
		}
		return l.Msg.UnreadCount, l.Msg.Items[0].Kind
	}

	orig, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "anyone up for pizza?"}))
	if err != nil {
		t.Fatal(err)
	}

	// bea replies: quote snapshot on the message, reply activity for owner.
	rep, err := svc.SendMessage(bea, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: channelID, Content: "yes!", ReplyToMessageId: orig.Msg.Message.Id,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if r := rep.Msg.Message.ReplyTo; r == nil || r.MessageId != orig.Msg.Message.Id || r.Author.Username != "owner" || r.Preview != "anyone up for pizza?" {
		t.Errorf("reply_to = %+v", rep.Msg.Message.ReplyTo)
	}
	if n, kind := unread(owner); n != 1 || kind != chatv1.ActivityKind_ACTIVITY_KIND_REPLY {
		t.Errorf("owner after reply: unread=%d kind=%v", n, kind)
	}

	// Self-reply: no activity. Reply that also @mentions the author: one item, not two.
	if _, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "(me)", ReplyToMessageId: orig.Msg.Message.Id})); err != nil {
		t.Fatal(err)
	}
	if n, _ := unread(owner); n != 1 {
		t.Errorf("self-reply notified: unread=%d", n)
	}
	if _, err := svc.SendMessage(bea, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "@owner see above", ReplyToMessageId: orig.Msg.Message.Id})); err != nil {
		t.Fatal(err)
	}
	if n, kind := unread(owner); n != 2 || kind != chatv1.ActivityKind_ACTIVITY_KIND_MENTION {
		t.Errorf("reply+mention should add exactly one (mention): unread=%d kind=%v", n, kind)
	}

	// Cross-channel reply rejected; unknown parent not found.
	if _, err := svc.SendMessage(bea, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: other.Msg.Channel.Id, Content: "x", ReplyToMessageId: orig.Msg.Message.Id})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("cross-channel reply: want invalid_argument, got %v", err)
	}
	if _, err := svc.SendMessage(bea, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "x", ReplyToMessageId: "00000000-0000-7000-8000-000000000000"})); code(err) != connect.CodeNotFound {
		t.Errorf("unknown parent: want not_found, got %v", err)
	}

	// ListMessages carries the snapshots.
	msgs, _ := svc.ListMessages(bea, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID}))
	if msgs.Msg.Messages[1].ReplyTo == nil || msgs.Msg.Messages[1].ReplyTo.Author.Username != "owner" || msgs.Msg.Messages[0].ReplyTo != nil {
		t.Errorf("ListMessages reply refs: %+v", msgs.Msg.Messages)
	}
}
