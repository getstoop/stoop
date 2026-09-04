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

func TestBlocks(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	alice := newUser(t, pool, "alice", authctx.RoleMember)
	bob := newUser(t, pool, "bob", authctx.RoleMember)
	aliceID, bobID := authctx.UserID(alice), authctx.UserID(bob)
	sp, err := svc.CreateSpace(alice, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	inv, _ := svc.CreateInvite(alice, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: sp.Msg.Space.Id}))
	if _, err := svc.JoinSpace(bob, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	// A conversation exists before the block.
	dm, err := svc.OpenDirectMessage(alice, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserId: bobID}))
	if err != nil {
		t.Fatal(err)
	}
	dmID := dm.Msg.DirectMessage.Channel.Id

	if _, err := svc.BlockUser(alice, connect.NewRequest(&chatv1.BlockUserRequest{UserId: aliceID})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("block self: %v", err)
	}
	if _, err := svc.BlockUser(alice, connect.NewRequest(&chatv1.BlockUserRequest{UserId: bobID})); err != nil {
		t.Fatal(err)
	}
	// No DMs either way; the conversation is hidden from alice, not bob.
	if _, err := svc.SendMessage(bob, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: dmID, Content: "hey"})); code(err) != connect.CodePermissionDenied {
		t.Errorf("blocked bob sends: want permission_denied, got %v", err)
	}
	if _, err := svc.SendMessage(alice, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: dmID, Content: "hey"})); code(err) != connect.CodePermissionDenied {
		t.Errorf("blocker sends: want permission_denied, got %v", err)
	}
	if _, err := svc.OpenDirectMessage(bob, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserId: aliceID})); code(err) != connect.CodePermissionDenied {
		t.Errorf("blocked opens DM: want permission_denied, got %v", err)
	}
	al, _ := svc.ListDirectMessages(alice, connect.NewRequest(&chatv1.ListDirectMessagesRequest{}))
	bl, _ := svc.ListDirectMessages(bob, connect.NewRequest(&chatv1.ListDirectMessagesRequest{}))
	if len(al.Msg.DirectMessages) != 0 || len(bl.Msg.DirectMessages) != 1 {
		t.Errorf("DM lists: alice %d (want 0), bob %d (want 1)", len(al.Msg.DirectMessages), len(bl.Msg.DirectMessages))
	}
	// A mention from bob in the space doesn't alert alice.
	if _, err := svc.SendMessage(bob, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: sp.Msg.DefaultChannel.Id, Content: "@alice hi"})); err != nil {
		t.Fatal(err)
	}
	notes, _ := svc.ListActivity(alice, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if len(notes.Msg.Items) != 0 {
		t.Errorf("blocked mention still notified: %v", notes.Msg.Items)
	}
	blocked, _ := svc.ListBlockedUsers(alice, connect.NewRequest(&chatv1.ListBlockedUsersRequest{}))
	if len(blocked.Msg.Users) != 1 || blocked.Msg.Users[0].Username != "bob" {
		t.Errorf("blocked list: %v", blocked.Msg.Users)
	}
	// Unblock restores everything.
	if _, err := svc.UnblockUser(alice, connect.NewRequest(&chatv1.UnblockUserRequest{UserId: bobID})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendMessage(bob, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: dmID, Content: "hey again"})); err != nil {
		t.Errorf("send after unblock: %v", err)
	}
	al, _ = svc.ListDirectMessages(alice, connect.NewRequest(&chatv1.ListDirectMessagesRequest{}))
	if len(al.Msg.DirectMessages) != 1 {
		t.Errorf("alice's DM list after unblock: %d", len(al.Msg.DirectMessages))
	}
}
