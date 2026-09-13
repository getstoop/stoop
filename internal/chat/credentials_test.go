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

// A credential narrower than its holder's role is refused what the role
// alone would allow: both gates must pass.
func TestCredentialNarrowsRole(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), noDirectory{})

	owner := newUser(t, pool, "owner", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id
	channels, err := svc.ListChannels(owner, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: spaceID}))
	if err != nil || len(channels.Msg.Channels) == 0 {
		t.Fatalf("list channels: %v", err)
	}
	channelID := channels.Msg.Channels[0].Id

	id, _ := authctx.From(owner)
	id.Credential = authctx.Credential{
		ID: "t", Kind: "personal_token",
		Grants: []authctx.Action{authctx.SpaceRead, authctx.MessagesRead},
	}
	readOnly := authctx.WithIdentity(context.Background(), id)

	refusedByToken := func(name string, err error) {
		t.Helper()
		if code(err) != connect.CodePermissionDenied || !strings.Contains(err.Error(), "token") {
			t.Errorf("%s: want a token refusal, got %v", name, err)
		}
	}

	_, err = svc.CreateChannel(readOnly, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: spaceID, Name: "nope"}))
	refusedByToken("owner's read-only token CreateChannel", err)
	_, err = svc.SendMessage(readOnly, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "hi"}))
	refusedByToken("owner's read-only token SendMessage", err)
	_, err = svc.DeleteSpace(readOnly, connect.NewRequest(&chatv1.DeleteSpaceRequest{SpaceId: spaceID}))
	refusedByToken("owner's read-only token DeleteSpace", err)

	if _, err := svc.ListMessages(readOnly, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID})); err != nil {
		t.Errorf("read-only token ListMessages: %v", err)
	}
	if ok, err := svc.MayReadSpace(readOnly, spaceID); err != nil || !ok {
		t.Errorf("read-only token MayReadSpace: %v, %v", ok, err)
	}

	id.Credential.Grants = []authctx.Action{authctx.SpaceRead}
	if ok, err := svc.MayReadSpace(authctx.WithIdentity(context.Background(), id), spaceID); err != nil || ok {
		t.Errorf("token without messages.read MayReadSpace: %v, %v", ok, err)
	}
}
