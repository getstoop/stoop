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

// Editing and reacting are writes: authorship alone does not carry them
// past a kick, a ban or a block. See docs/architecture/messaging.md →
// Edits, deletions, reactions, replies.
func TestWritesStopAtKickBanAndBlock(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	beaID, caseyID := authctx.UserID(bea), authctx.UserID(casey)

	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	join := func(ctx context.Context) {
		t.Helper()
		inv, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := svc.JoinSpace(ctx, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
			t.Fatal(err)
		}
	}
	join(bea)
	join(casey)

	edit := func(ctx context.Context, id string) error {
		_, err := svc.EditMessage(ctx, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: id, Content: "rewritten"}))
		return err
	}
	react := func(ctx context.Context, id string) error {
		_, err := svc.ToggleReaction(ctx, connect.NewRequest(&chatv1.ToggleReactionRequest{MessageId: id, Emoji: "👍"}))
		return err
	}

	beaMsg, err := svc.SendMessage(bea, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "hello"}))
	if err != nil {
		t.Fatal(err)
	}
	caseyMsg, err := svc.SendMessage(casey, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "hi"}))
	if err != nil {
		t.Fatal(err)
	}

	sub := bus.Subscribe("space:" + spaceID)
	defer sub.Close()
	silent := func(what string) {
		t.Helper()
		for {
			select {
			case ev := <-sub.Events():
				// Membership events are expected; message traffic is not.
				if ev.GetMessageUpdated() != nil || ev.GetReactionsChanged() != nil {
					t.Errorf("%s: published %T", what, ev.Payload)
				}
			default:
				return
			}
		}
	}

	// Kicked: bea's own message is still hers, and still not hers to edit.
	if _, err := svc.KickMember(owner, connect.NewRequest(&chatv1.KickMemberRequest{SpaceId: spaceID, UserId: beaID})); err != nil {
		t.Fatal(err)
	}
	if err := edit(bea, beaMsg.Msg.Message.Id); code(err) != connect.CodePermissionDenied {
		t.Errorf("edit after kick: want permission_denied, got %v", err)
	}
	if err := react(bea, caseyMsg.Msg.Message.Id); code(err) != connect.CodePermissionDenied {
		t.Errorf("react after kick: want permission_denied, got %v", err)
	}
	silent("kicked member")

	// Banned: the same, and rejoining is not on the table either.
	join(bea)
	if _, err := svc.BanMember(owner, connect.NewRequest(&chatv1.BanMemberRequest{SpaceId: spaceID, UserId: beaID})); err != nil {
		t.Fatal(err)
	}
	if err := edit(bea, beaMsg.Msg.Message.Id); code(err) != connect.CodePermissionDenied {
		t.Errorf("edit after ban: want permission_denied, got %v", err)
	}
	if err := react(bea, caseyMsg.Msg.Message.Id); code(err) != connect.CodePermissionDenied {
		t.Errorf("react after ban: want permission_denied, got %v", err)
	}
	silent("banned member")

	// The message itself never changed.
	msgs, err := svc.ListMessages(casey, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID}))
	if err != nil {
		t.Fatal(err)
	}
	if got := msgs.Msg.Messages[0].Content; got != "hello" {
		t.Errorf("message content after refused edits = %q, want %q", got, "hello")
	}

	// A DM, then a block: neither side may edit or react afterwards.
	dm, err := svc.OpenDirectMessage(owner, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserId: caseyID}))
	if err != nil {
		t.Fatal(err)
	}
	dmID := dm.Msg.DirectMessage.Channel.Id
	ownerDM, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: dmID, Content: "you there?"}))
	if err != nil {
		t.Fatal(err)
	}
	caseyDM, err := svc.SendMessage(casey, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: dmID, Content: "here"}))
	if err != nil {
		t.Fatal(err)
	}
	dmSub := bus.Subscribe("user:" + caseyID)
	defer dmSub.Close()
	if _, err := svc.BlockUser(owner, connect.NewRequest(&chatv1.BlockUserRequest{UserId: caseyID})); err != nil {
		t.Fatal(err)
	}
	if err := edit(casey, caseyDM.Msg.Message.Id); code(err) != connect.CodePermissionDenied {
		t.Errorf("blocked author edits: want permission_denied, got %v", err)
	}
	if err := react(casey, ownerDM.Msg.Message.Id); code(err) != connect.CodePermissionDenied {
		t.Errorf("blocked user reacts: want permission_denied, got %v", err)
	}
	if err := edit(owner, ownerDM.Msg.Message.Id); code(err) != connect.CodePermissionDenied {
		t.Errorf("blocker edits: want permission_denied, got %v", err)
	}
	if err := react(owner, caseyDM.Msg.Message.Id); code(err) != connect.CodePermissionDenied {
		t.Errorf("blocker reacts: want permission_denied, got %v", err)
	}
	for {
		select {
		case ev := <-dmSub.Events():
			if ev.GetMessageUpdated() != nil || ev.GetReactionsChanged() != nil {
				t.Errorf("blocked DM: published %T", ev.Payload)
			}
			continue
		default:
		}
		break
	}
}
