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

func TestSetChannelMuted(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	outsider := newUser(t, pool, "outsider", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id

	sub := bus.Subscribe("user:" + authctx.UserID(owner))
	defer sub.Close()
	res, err := svc.SetChannelMuted(owner, connect.NewRequest(&chatv1.SetChannelMutedRequest{ChannelId: channelID, Muted: true}))
	if err != nil || !res.Msg.Channel.Muted {
		t.Fatalf("mute: %v %v", res, err)
	}
	if ev := nextEvent(t, sub); ev.GetChannelMuted() == nil || !ev.GetChannelMuted().Muted || ev.GetChannelMuted().SpaceId != spaceID {
		t.Errorf("want ChannelMuted on the personal topic, got %v", ev.Payload)
	}
	// Idempotent, and visible in the channel list.
	if _, err := svc.SetChannelMuted(owner, connect.NewRequest(&chatv1.SetChannelMutedRequest{ChannelId: channelID, Muted: true})); err != nil {
		t.Errorf("mute twice: %v", err)
	}
	list, _ := svc.ListChannels(owner, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: spaceID}))
	if !list.Msg.Channels[0].Muted {
		t.Errorf("ListChannels doesn't show the mute")
	}
	// A muted channel's messages don't make the space unread.
	other := newUser(t, pool, "other", authctx.RoleMember)
	inv, _ := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if _, err := svc.JoinSpace(other, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendMessage(other, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "hi"})); err != nil {
		t.Fatal(err)
	}
	spaces, _ := svc.ListSpaces(owner, connect.NewRequest(&chatv1.ListSpacesRequest{}))
	if spaces.Msg.Spaces[0].HasUnread {
		t.Errorf("muted channel made the space unread")
	}
	if _, err := svc.SetChannelMuted(owner, connect.NewRequest(&chatv1.SetChannelMutedRequest{ChannelId: channelID, Muted: false})); err != nil {
		t.Fatal(err)
	}
	spaces, _ = svc.ListSpaces(owner, connect.NewRequest(&chatv1.ListSpacesRequest{}))
	if !spaces.Msg.Spaces[0].HasUnread {
		t.Errorf("after unmuting, the space should be unread")
	}
	if _, err := svc.SetChannelMuted(outsider, connect.NewRequest(&chatv1.SetChannelMutedRequest{ChannelId: channelID, Muted: true})); code(err) != connect.CodePermissionDenied {
		t.Errorf("outsider mute: want permission_denied, got %v", err)
	}
}
