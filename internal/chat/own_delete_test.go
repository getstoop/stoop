package chat_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

// Deleting your own message is a posting action in that channel's kind:
// a token granted only dms.post can't delete in a space, nor the other
// way round.
func TestOwnDeleteNeedsTheChannelsPostAction(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	alice := newUser(t, pool, "alice", authctx.RoleMember)
	bob := newUser(t, pool, "bob", authctx.RoleMember)
	bobID, _ := authctx.From(bob)

	sp, err := svc.CreateSpace(alice, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AddMember(alice, connect.NewRequest(&chatv1.AddMemberRequest{SpaceId: sp.Msg.Space.Id, UserId: bobID.UserID})); err != nil {
		t.Fatal(err)
	}
	inSpace, err := svc.SendMessage(alice, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: sp.Msg.DefaultChannel.Id, Content: "space"}))
	if err != nil {
		t.Fatal(err)
	}
	dm, err := svc.OpenDirectMessage(alice, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: []string{bobID.UserID}}))
	if err != nil {
		t.Fatal(err)
	}
	inDM, err := svc.SendMessage(alice, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: dm.Msg.DirectMessage.Channel.Id, Content: "dm"}))
	if err != nil {
		t.Fatal(err)
	}

	withGrant := func(grants ...authctx.Action) context.Context {
		id, _ := authctx.From(alice)
		id.Credential = authctx.Credential{ID: "t", Kind: authctx.CredentialPersonalToken, Grants: grants}
		return authctx.WithIdentity(context.Background(), id)
	}
	dmOnly, spaceOnly := withGrant(authctx.DMsPost), withGrant(authctx.MessagesPost)

	if _, err := svc.DeleteMessage(dmOnly, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: inSpace.Msg.Message.Id})); code(err) != connect.CodePermissionDenied || !strings.Contains(err.Error(), "token") {
		t.Errorf("dms.post token deleted a space message: %v", err)
	}
	if _, err := svc.DeleteMessage(spaceOnly, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: inDM.Msg.Message.Id})); code(err) != connect.CodePermissionDenied || !strings.Contains(err.Error(), "token") {
		t.Errorf("messages.post token deleted a DM: %v", err)
	}
	if _, err := svc.DeleteMessage(spaceOnly, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: inSpace.Msg.Message.Id})); err != nil {
		t.Errorf("messages.post token deleting its own space message: %v", err)
	}
	if _, err := svc.DeleteMessage(dmOnly, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: inDM.Msg.Message.Id})); err != nil {
		t.Errorf("dms.post token deleting its own DM: %v", err)
	}
}
