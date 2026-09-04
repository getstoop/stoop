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

func TestUnreadMarkers(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	sp, _ := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	inv, _ := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if _, err := svc.JoinSpace(bea, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	channelOf := func(ctx context.Context) *chatv1.Channel {
		res, err := svc.ListChannels(ctx, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: spaceID}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Channels[0]
	}
	unread := func(c *chatv1.Channel) bool { return c.LastMessageId != "" && c.LastMessageId > c.LastReadMessageId }
	spaceUnread := func(ctx context.Context) bool {
		res, _ := svc.ListSpaces(ctx, connect.NewRequest(&chatv1.ListSpacesRequest{}))
		return res.Msg.Spaces[0].HasUnread
	}

	// Empty channel: nothing to read.
	if c := channelOf(bea); c.LastMessageId != "" || unread(c) || spaceUnread(bea) {
		t.Errorf("fresh channel should not be unread: %+v", c)
	}

	// Owner posts: unread for bea, read for the author; space flag follows.
	msg, err := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "hello"}))
	if err != nil {
		t.Fatal(err)
	}
	if msg.Msg.Message.SpaceId != spaceID {
		t.Errorf("message space_id = %q", msg.Msg.Message.SpaceId)
	}
	if c := channelOf(bea); !unread(c) || c.LastMessageId != msg.Msg.Message.Id {
		t.Errorf("bea should see unread: %+v", c)
	}
	if c := channelOf(owner); unread(c) {
		t.Errorf("author's own message must not be unread for them: %+v", c)
	}
	if !spaceUnread(bea) || spaceUnread(owner) {
		t.Error("space has_unread should be true for bea, false for owner")
	}

	// bea marks read (event on her topic), then it's read; a new post flips it back.
	sub := bus.Subscribe("user:" + authctx.UserID(bea))
	defer sub.Close()
	mr, err := svc.MarkChannelRead(bea, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: channelID}))
	if err != nil || mr.Msg.LastReadMessageId != msg.Msg.Message.Id {
		t.Fatalf("mark read: %v %v", mr, err)
	}
	if ev := (<-sub.Events()).GetChannelRead(); ev == nil || ev.ChannelId != channelID || ev.SpaceId != spaceID {
		t.Error("expected ChannelRead event on bea's topic")
	}
	if c := channelOf(bea); unread(c) || spaceUnread(bea) {
		t.Errorf("after mark read: %+v", c)
	}
	msg2, _ := svc.SendMessage(owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "again"}))
	if c := channelOf(bea); !unread(c) || c.UnreadCount != 1 {
		t.Errorf("new post should be unread again with count 1: %+v", c)
	}
	if c := channelOf(owner); c.UnreadCount != 0 {
		t.Errorf("author unread_count = %d", c.UnreadCount)
	}
	// Marking read at an older message doesn't move the marker backwards.
	if _, err := svc.MarkChannelRead(bea, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: channelID, MessageId: msg2.Msg.Message.Id})); err != nil {
		t.Fatal(err)
	}
	<-sub.Events()
	if _, err := svc.MarkChannelRead(bea, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: channelID, MessageId: msg.Msg.Message.Id})); err != nil {
		t.Fatal(err)
	}
	if c := channelOf(bea); c.LastReadMessageId != msg2.Msg.Message.Id {
		t.Errorf("marker moved backwards: %+v", c)
	}
}

func TestChannelManagement(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	member := newUser(t, pool, "member", authctx.RoleMember)
	sp, _ := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	spaceID, general := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	inv, _ := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if _, err := svc.JoinSpace(member, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	sub := bus.Subscribe("space:" + spaceID)
	defer sub.Close()

	// Only one channel: can't delete it.
	if _, err := svc.DeleteChannel(owner, connect.NewRequest(&chatv1.DeleteChannelRequest{ChannelId: general})); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("deleting the last channel: want failed_precondition, got %v", err)
	}
	random, _ := svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: spaceID, Name: "random"}))
	<-sub.Events()

	// Rename: member denied; owner OK with event; validation.
	name := "lounge"
	if _, err := svc.UpdateChannel(member, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: general, Name: &name})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member rename: %v", err)
	}
	up, err := svc.UpdateChannel(owner, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: general, Name: &name}))
	if err != nil || up.Msg.Channel.Name != "lounge" {
		t.Fatalf("rename: %v %v", up, err)
	}
	if ev := (<-sub.Events()).GetChannelUpdated(); ev == nil || ev.Name != "lounge" {
		t.Error("expected ChannelUpdated")
	}
	empty := ""
	if _, err := svc.UpdateChannel(owner, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: general, Name: &empty})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("empty rename: %v", err)
	}

	// Topic: member denied; owner OK, collapsed to one line, on the event;
	// too long refused; a rename alone leaves it alone; empty clears it.
	topic := "Cards and\ncomplaints"
	if _, err := svc.UpdateChannel(member, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: general, Topic: &topic})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member topic: %v", err)
	}
	up, err = svc.UpdateChannel(owner, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: general, Topic: &topic}))
	if err != nil || up.Msg.Channel.Topic != "Cards and complaints" {
		t.Fatalf("set topic: %v %v", up, err)
	}
	if ev := (<-sub.Events()).GetChannelUpdated(); ev == nil || ev.Topic != "Cards and complaints" {
		t.Error("expected the topic on ChannelUpdated")
	}
	long := strings.Repeat("x", 251)
	if _, err := svc.UpdateChannel(owner, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: general, Topic: &long})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("over-long topic: %v", err)
	}
	back := "lounge"
	up, err = svc.UpdateChannel(owner, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: general, Name: &back}))
	if err != nil || up.Msg.Channel.Topic != "Cards and complaints" {
		t.Fatalf("rename must leave the topic alone: %v %v", up, err)
	}
	<-sub.Events()
	up, err = svc.UpdateChannel(owner, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: general, Topic: &empty}))
	if err != nil || up.Msg.Channel.Topic != "" {
		t.Fatalf("clear topic: %v %v", up, err)
	}
	<-sub.Events()

	// Reorder: must list all exactly once; result and event reflect the order.
	if _, err := svc.ReorderChannels(owner, connect.NewRequest(&chatv1.ReorderChannelsRequest{SpaceId: spaceID, ChannelIds: []string{general}})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("partial reorder: %v", err)
	}
	ro, err := svc.ReorderChannels(owner, connect.NewRequest(&chatv1.ReorderChannelsRequest{SpaceId: spaceID, ChannelIds: []string{random.Msg.Channel.Id, general}}))
	if err != nil || ro.Msg.Channels[0].Id != random.Msg.Channel.Id || ro.Msg.Channels[1].Id != general {
		t.Fatalf("reorder: %v %v", ro, err)
	}
	if ev := (<-sub.Events()).GetChannelsReordered(); ev == nil || ev.Channels[0].Id != random.Msg.Channel.Id {
		t.Error("expected ChannelsReordered")
	}
	if _, err := svc.ReorderChannels(member, connect.NewRequest(&chatv1.ReorderChannelsRequest{SpaceId: spaceID, ChannelIds: []string{general, random.Msg.Channel.Id}})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member reorder: %v", err)
	}

	// Delete: member denied; owner OK with event; messages go with it.
	if _, err := svc.SendMessage(member, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: random.Msg.Channel.Id, Content: "bye"})); err != nil {
		t.Fatal(err)
	}
	<-sub.Events()
	if _, err := svc.DeleteChannel(member, connect.NewRequest(&chatv1.DeleteChannelRequest{ChannelId: random.Msg.Channel.Id})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member delete: %v", err)
	}
	if _, err := svc.DeleteChannel(owner, connect.NewRequest(&chatv1.DeleteChannelRequest{ChannelId: random.Msg.Channel.Id})); err != nil {
		t.Fatal(err)
	}
	if ev := (<-sub.Events()).GetChannelDeleted(); ev == nil || ev.ChannelId != random.Msg.Channel.Id {
		t.Error("expected ChannelDeleted")
	}
	chs, _ := svc.ListChannels(owner, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: spaceID}))
	if len(chs.Msg.Channels) != 1 || chs.Msg.Channels[0].Name != "lounge" {
		t.Errorf("channels after delete: %+v", chs.Msg.Channels)
	}
}

func TestIsVoiceChannel(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	voice, err := svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: sp.Msg.Space.Id, Name: "lounge", Kind: chatv1.ChannelKind_CHANNEL_KIND_VOICE,
	}))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	for _, tc := range []struct {
		name, id string
		want     bool
	}{
		{"voice", voice.Msg.Channel.Id, true},
		{"text", sp.Msg.DefaultChannel.Id, false},
		{"unknown", "00000000-0000-0000-0000-000000000000", false},
	} {
		got, err := svc.IsVoiceChannel(ctx, tc.id)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if got != tc.want {
			t.Errorf("%s: IsVoiceChannel = %v, want %v", tc.name, got, tc.want)
		}
		space, _ := svc.VoiceChannelSpace(ctx, tc.id)
		if want := ""; tc.want {
			want = sp.Msg.Space.Id
			if space != want {
				t.Errorf("%s: VoiceChannelSpace = %q, want %q", tc.name, space, want)
			}
		} else if space != "" {
			t.Errorf("%s: VoiceChannelSpace = %q, want empty", tc.name, space)
		}
	}
}
