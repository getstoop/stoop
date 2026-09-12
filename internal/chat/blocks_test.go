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
	dm, err := svc.OpenDirectMessage(alice, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: []string{bobID}}))
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
	if _, err := svc.OpenDirectMessage(bob, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: []string{aliceID}})); code(err) != connect.CodePermissionDenied {
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

// Blocking clears the alerts it is meant to silence. Without this the
// rail keeps a badge the person cannot clear: the conversation is hidden
// from their list, so there is nothing left to open and mark read.
func TestBlockClearsTheirActivity(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	alice := newUser(t, pool, "alice", authctx.RoleMember)
	bob := newUser(t, pool, "bob", authctx.RoleMember)
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	aliceID, bobID := authctx.UserID(alice), authctx.UserID(bob)

	sp, err := svc.CreateSpace(alice, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	joinSpace(t, svc, alice, sp.Msg.Space.Id, bob, casey)

	unread := func(who context.Context) int32 {
		t.Helper()
		got, err := svc.ListActivity(who, connect.NewRequest(&chatv1.ListActivityRequest{}))
		if err != nil {
			t.Fatal(err)
		}
		return got.Msg.UnreadCount
	}

	// Bob messages alice directly; casey brings the three of them together
	// and messages there too. Alice has an alert from each.
	pair := openDM(t, svc, bob, aliceID)
	if _, err := svc.SendMessage(bob, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: pair.Channel.Id, Content: "just us",
	})); err != nil {
		t.Fatal(err)
	}
	group := openDM(t, svc, casey, aliceID, bobID)
	if _, err := svc.SendMessage(casey, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: group.Channel.Id, Content: "the three of us",
	})); err != nil {
		t.Fatal(err)
	}
	if n := unread(alice); n != 2 {
		t.Fatalf("alice's unread before the block: got %d, want 2", n)
	}

	if _, err := svc.BlockUser(alice, connect.NewRequest(&chatv1.BlockUserRequest{UserId: bobID})); err != nil {
		t.Fatal(err)
	}

	// Both go: bob's own alert because he caused it, and casey's because
	// it points at a conversation bob is in, which alice can no longer see.
	if n := unread(alice); n != 0 {
		t.Errorf("alice's unread after blocking bob: got %d, want 0", n)
	}
	listed, err := svc.ListActivity(alice, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Msg.Items) != 0 {
		t.Errorf("alice's feed still holds %d item(s) she cannot open", len(listed.Msg.Items))
	}

	// Nobody else's feed is touched, and casey — who blocked no one — keeps
	// the conversation.
	if n := unread(casey); n != 0 {
		t.Errorf("casey has alerts he should not: %d", n)
	}
	casesDMs, err := svc.ListDirectMessages(casey, connect.NewRequest(&chatv1.ListDirectMessagesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	var kept bool
	for _, dm := range casesDMs.Msg.DirectMessages {
		if dm.Channel.Id == group.Channel.Id {
			kept = true
		}
	}
	if !kept {
		t.Errorf("somebody else's block took the conversation from casey")
	}
}
