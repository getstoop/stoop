package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

func (f fixture) newChannel(t *testing.T, req *chatv1.CreateChannelRequest) *chatv1.Channel {
	t.Helper()
	req.SpaceId = f.spaceID
	res, err := f.svc.CreateChannel(f.owner, connect.NewRequest(req))
	if err != nil {
		t.Fatal(err)
	}
	return res.Msg.Channel
}

func (f fixture) listed(t *testing.T, ctx context.Context, channelID string) *chatv1.Channel {
	t.Helper()
	res, err := f.svc.ListChannels(ctx, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: f.spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	for _, channel := range res.Msg.Channels {
		if channel.Id == channelID {
			return channel
		}
	}
	t.Fatalf("channel %s is not listed", channelID)
	return nil
}

func (f fixture) memberNames(t *testing.T, channelID string) []string {
	t.Helper()
	res, err := f.svc.ListChannelMembers(f.member, connect.NewRequest(&chatv1.ListChannelMembersRequest{ChannelId: channelID}))
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, len(res.Msg.Members))
	for index, member := range res.Msg.Members {
		names[index] = member.Username
	}
	return names
}

func TestJoinAndLeaveChannel(t *testing.T) {
	space := newFixture(t)
	garden := space.newChannel(t, &chatv1.CreateChannelRequest{Name: "garden"})
	if !garden.Joined || garden.MemberCount != 1 {
		t.Errorf("creator: joined = %v, members = %d, want true and 1", garden.Joined, garden.MemberCount)
	}
	sent, err := space.svc.SendMessage(space.owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "rota is up"}))
	if err != nil {
		t.Fatal(err)
	}

	// Everyone in the space sees the channel listed, joined or not.
	if before := space.listed(t, space.member, garden.Id); before.Joined || before.MemberCount != 1 {
		t.Errorf("before joining: joined = %v, members = %d, want false and 1", before.Joined, before.MemberCount)
	}

	sub := space.bus.Subscribe("space:" + space.spaceID)
	defer sub.Close()
	joined, err := space.svc.JoinChannel(space.member, connect.NewRequest(&chatv1.JoinChannelRequest{ChannelId: garden.Id}))
	if err != nil {
		t.Fatal(err)
	}
	if !joined.Msg.Channel.Joined || joined.Msg.Channel.LastReadMessageId != sent.Msg.Message.Id {
		t.Errorf("join answered joined = %v, read to %q, want true and the newest message", joined.Msg.Channel.Joined, joined.Msg.Channel.LastReadMessageId)
	}
	if ev := (<-sub.Events()).GetChannelMemberJoined(); ev == nil || ev.ChannelId != garden.Id || ev.UserId != authctx.UserID(space.member) {
		t.Fatal("expected ChannelMemberJoined for the member")
	}
	// The channel arrives read, not with its history unread.
	if after := space.listed(t, space.member, garden.Id); !after.Joined || after.MemberCount != 2 || after.UnreadCount != 0 {
		t.Errorf("after joining: joined = %v, members = %d, unread = %d, want true, 2, 0", after.Joined, after.MemberCount, after.UnreadCount)
	}
	// Joining twice changes nothing and tells nobody.
	if _, err := space.svc.JoinChannel(space.member, connect.NewRequest(&chatv1.JoinChannelRequest{ChannelId: garden.Id})); err != nil {
		t.Fatal(err)
	}

	if _, err := space.svc.LeaveChannel(space.member, connect.NewRequest(&chatv1.LeaveChannelRequest{ChannelId: garden.Id})); err != nil {
		t.Fatal(err)
	}
	if ev := (<-sub.Events()).GetChannelMemberLeft(); ev == nil || ev.ChannelId != garden.Id || ev.UserId != authctx.UserID(space.member) {
		t.Fatal("expected ChannelMemberLeft for the member, with no second join before it")
	}
	if after := space.listed(t, space.member, garden.Id); after.Joined || after.MemberCount != 1 {
		t.Errorf("after leaving: joined = %v, members = %d, want false and 1", after.Joined, after.MemberCount)
	}
	// Leaving a channel you are not in is not an error.
	if _, err := space.svc.LeaveChannel(space.member, connect.NewRequest(&chatv1.LeaveChannelRequest{ChannelId: garden.Id})); err != nil {
		t.Errorf("leaving twice: %v", err)
	}
}

func (f fixture) general(t *testing.T) *chatv1.Channel {
	t.Helper()
	res, err := f.svc.ListChannels(f.owner, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: f.spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	return res.Msg.Channels[0]
}

func TestChannelMembershipRefusals(t *testing.T) {
	space := newFixture(t)
	general := space.general(t)
	if !general.Required || !general.Joined || general.MemberCount != 4 {
		t.Fatalf("#general: required = %v, joined = %v, members = %d, want true, true, 4", general.Required, general.Joined, general.MemberCount)
	}
	if _, err := space.svc.LeaveChannel(space.member, connect.NewRequest(&chatv1.LeaveChannelRequest{ChannelId: general.Id})); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("leaving a required channel: code = %v, want FailedPrecondition", code(err))
	}

	steps := space.newChannel(t, &chatv1.CreateChannelRequest{Name: "steps", Kind: chatv1.ChannelKind_CHANNEL_KIND_VOICE})
	// A voice channel has no membership: everyone counts as in it.
	if listed := space.listed(t, space.member, steps.Id); !listed.Joined || listed.MemberCount != 0 {
		t.Errorf("voice channel: joined = %v, members = %d, want true and 0", listed.Joined, listed.MemberCount)
	}
	if _, err := space.svc.JoinChannel(space.member, connect.NewRequest(&chatv1.JoinChannelRequest{ChannelId: steps.Id})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("joining a voice channel: code = %v, want InvalidArgument", code(err))
	}
	if _, err := space.svc.CreateChannel(space.owner, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: space.spaceID, Name: "stage", Kind: chatv1.ChannelKind_CHANNEL_KIND_VOICE, Required: true,
	})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("a required voice channel: code = %v, want InvalidArgument", code(err))
	}

	garden := space.newChannel(t, &chatv1.CreateChannelRequest{Name: "garden"})
	// Someone outside the space can neither join nor see who is in it.
	if _, err := space.svc.JoinChannel(space.operator, connect.NewRequest(&chatv1.JoinChannelRequest{ChannelId: garden.Id})); code(err) != connect.CodePermissionDenied {
		t.Errorf("joining from outside the space: code = %v, want PermissionDenied", code(err))
	}
	if _, err := space.svc.ListChannelMembers(space.operator, connect.NewRequest(&chatv1.ListChannelMembersRequest{ChannelId: garden.Id})); code(err) != connect.CodePermissionDenied {
		t.Errorf("listing from outside the space: code = %v, want PermissionDenied", code(err))
	}
	// Adding other people is for those who manage channels.
	if _, err := space.svc.AddChannelMembers(space.member, connect.NewRequest(&chatv1.AddChannelMembersRequest{
		ChannelId: garden.Id, UserIds: []string{authctx.UserID(space.other)},
	})); code(err) != connect.CodePermissionDenied {
		t.Errorf("a member adding people: code = %v, want PermissionDenied", code(err))
	}
}

func TestAddChannelMembers(t *testing.T) {
	space := newFixture(t)
	garden := space.newChannel(t, &chatv1.CreateChannelRequest{Name: "garden"})
	sent, err := space.svc.SendMessage(space.owner, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "rota is up"}))
	if err != nil {
		t.Fatal(err)
	}

	sub := space.bus.Subscribe("space:" + space.spaceID)
	defer sub.Close()
	// The operator is not in the space and the owner is already in the
	// channel: only the member is added.
	res, err := space.svc.AddChannelMembers(space.admin, connect.NewRequest(&chatv1.AddChannelMembersRequest{
		ChannelId: garden.Id, UserIds: []string{authctx.UserID(space.member), authctx.UserID(space.operator), authctx.UserID(space.owner)},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Msg.AddedUserIds) != 1 || res.Msg.AddedUserIds[0] != authctx.UserID(space.member) {
		t.Errorf("added = %v, want only the member", res.Msg.AddedUserIds)
	}
	if ev := (<-sub.Events()).GetChannelMemberJoined(); ev == nil || ev.UserId != authctx.UserID(space.member) {
		t.Fatal("expected ChannelMemberJoined for the member")
	}
	if names := space.memberNames(t, garden.Id); len(names) != 2 || names[0] != "owner" || names[1] != "member" {
		t.Errorf("members = %v, want [owner member]", names)
	}
	if listed := space.listed(t, space.member, garden.Id); listed.LastReadMessageId != sent.Msg.Message.Id || listed.UnreadCount != 0 {
		t.Errorf("an added member finds %d unread, want the channel read", listed.UnreadCount)
	}
	if _, err := space.svc.AddChannelMembers(space.admin, connect.NewRequest(&chatv1.AddChannelMembersRequest{
		ChannelId: garden.Id, UserIds: []string{"not-an-id"},
	})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("a malformed id: code = %v, want InvalidArgument", code(err))
	}
}

func TestRequiredChannels(t *testing.T) {
	space := newFixture(t)
	general := space.general(t)

	// Made required: everyone in the space is in it from the start.
	notices := space.newChannel(t, &chatv1.CreateChannelRequest{Name: "notices", Required: true})
	if !notices.Required || notices.MemberCount != 4 {
		t.Errorf("a required channel: required = %v, members = %d, want true and 4", notices.Required, notices.MemberCount)
	}
	// Made with people named: the creator and those of them in the space.
	tools := space.newChannel(t, &chatv1.CreateChannelRequest{
		Name: "tools", MemberIds: []string{authctx.UserID(space.member), authctx.UserID(space.operator)},
	})
	if names := space.memberNames(t, tools.Id); len(names) != 2 || names[0] != "owner" || names[1] != "member" {
		t.Errorf("members = %v, want [owner member]", names)
	}

	// Turned on later: everyone joins, and the space is told once.
	sub := space.bus.Subscribe("space:" + space.spaceID)
	defer sub.Close()
	updated, err := space.svc.UpdateChannel(space.admin, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: tools.Id, Required: ptr(true)}))
	if err != nil {
		t.Fatal(err)
	}
	if !updated.Msg.Channel.Required {
		t.Error("the channel did not become required")
	}
	if ev := (<-sub.Events()).GetChannelUpdated(); ev == nil || !ev.Required {
		t.Fatal("expected ChannelUpdated saying it is required")
	}
	if names := space.memberNames(t, tools.Id); len(names) != 4 {
		t.Errorf("members = %v, want all four", names)
	}
	// Turned off: nobody is removed, and people may leave again.
	if _, err := space.svc.UpdateChannel(space.admin, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: tools.Id, Required: ptr(false)})); err != nil {
		t.Fatal(err)
	}
	if names := space.memberNames(t, tools.Id); len(names) != 4 {
		t.Errorf("members after it stopped being required = %v, want all four", names)
	}
	if _, err := space.svc.LeaveChannel(space.other, connect.NewRequest(&chatv1.LeaveChannelRequest{ChannelId: tools.Id})); err != nil {
		t.Errorf("leaving once it is no longer required: %v", err)
	}

	// The default channel stays required until another is chosen.
	if _, err := space.svc.UpdateChannel(space.owner, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: general.Id, Required: ptr(false)})); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("un-requiring the default: code = %v, want FailedPrecondition", code(err))
	}
	garden := space.newChannel(t, &chatv1.CreateChannelRequest{Name: "garden"})
	if _, err := space.svc.UpdateSpace(space.owner, connect.NewRequest(&chatv1.UpdateSpaceRequest{SpaceId: space.spaceID, DefaultChannelId: ptr(garden.Id)})); err != nil {
		t.Fatal(err)
	}
	if listed := space.listed(t, space.other, garden.Id); !listed.Required || !listed.Joined || listed.MemberCount != 4 {
		t.Errorf("the new default: required = %v, joined = %v, members = %d, want true, true, 4", listed.Required, listed.Joined, listed.MemberCount)
	}
	if _, err := space.svc.UpdateChannel(space.owner, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: general.Id, Required: ptr(false)})); err != nil {
		t.Errorf("un-requiring the old default: %v", err)
	}
}
