package chat_test

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

func TestCreatePrivateChannel(t *testing.T) {
	fixture := newPrivateFixture(t)
	svc := fixture.svc
	space := fixture.bus.Subscribe("space:" + fixture.spaceID)
	defer space.Close()
	creator := fixture.bus.Subscribe("user:" + authctx.UserID(fixture.owner))
	defer creator.Close()

	created, err := svc.CreateChannel(fixture.owner, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: fixture.spaceID, Name: "captains", Private: true,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if !created.Msg.Channel.Private {
		t.Error("the channel did not come back private")
	}
	people, err := svc.ListChannelMembers(fixture.owner, connect.NewRequest(&chatv1.ListChannelMembersRequest{ChannelId: created.Msg.Channel.Id}))
	if err != nil || len(people.Msg.UserIds) != 1 || people.Msg.UserIds[0] != authctx.UserID(fixture.owner) {
		t.Errorf("the creator is not the first member: %v %v", people, err)
	}
	if got := received(space); len(got) != 0 {
		t.Errorf("the space was told about a private channel: %v", got)
	}
	if got := received(creator); len(got) != 1 {
		t.Errorf("the creator was sent %v, want the new channel", got)
	}

	// A server admin who has not joined the space manages its channels,
	// but can't be a private channel's first member.
	operator := newUser(t, fixture.pool, "operator", authctx.RoleAdmin)
	if _, err := svc.CreateChannel(operator, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: fixture.spaceID, Name: "ops", Private: true,
	})); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("a private channel by someone outside the space: %v, want failed precondition", err)
	}
}

func TestPrivateChannelPeople(t *testing.T) {
	fixture := newPrivateFixture(t)
	svc := fixture.svc
	stranger := newUser(t, fixture.pool, "stranger", authctx.RoleMember)
	add := func(by context.Context, channelID string, people ...context.Context) error {
		ids := make([]string, len(people))
		for index, person := range people {
			ids[index] = authctx.UserID(person)
		}
		_, err := svc.AddChannelMembers(by, connect.NewRequest(&chatv1.AddChannelMembersRequest{ChannelId: channelID, UserIds: ids}))
		return err
	}
	members := func(by context.Context) ([]string, error) {
		res, err := svc.ListChannelMembers(by, connect.NewRequest(&chatv1.ListChannelMembersRequest{ChannelId: fixture.secretID}))
		if err != nil {
			return nil, err
		}
		return res.Msg.UserIds, nil
	}

	if err := add(fixture.bea, fixture.secretID, fixture.cal); code(err) != connect.CodePermissionDenied {
		t.Errorf("a member adding someone: %v, want permission denied", err)
	}
	if err := add(fixture.owner, fixture.secretID, stranger); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("adding someone outside the space: %v, want failed precondition", err)
	}
	if err := add(fixture.owner, fixture.generalID, fixture.cal); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("adding to a public channel: %v, want failed precondition", err)
	}
	if _, err := members(fixture.cal); code(err) != connect.CodeNotFound {
		t.Errorf("the people list for someone outside: %v, want not found", err)
	}
	// Someone in it, and an admin outside it, see who is in it.
	for name, person := range map[string]context.Context{"bea": fixture.bea, "owner": fixture.owner} {
		if ids, err := members(person); err != nil || len(ids) != 1 {
			t.Errorf("the people list for %s: %v %v", name, ids, err)
		}
	}

	fixture.send(t, fixture.bea, "before cal arrived "+mentionOf(fixture.cal), "")
	added := fixture.bus.Subscribe("user:" + authctx.UserID(fixture.cal))
	defer added.Close()
	inside := fixture.bus.Subscribe("user:" + authctx.UserID(fixture.bea))
	defer inside.Close()
	if err := add(fixture.owner, fixture.secretID, fixture.cal, fixture.bea); err != nil {
		t.Fatal(err)
	}
	if got := received(added); len(got) != 2 {
		t.Errorf("the person added was sent %v, want the channel and the join", got)
	}
	if got := received(inside); len(got) != 1 {
		t.Errorf("someone already in was sent %v, want one join", got)
	}
	// History is all of it for someone added later.
	history, err := svc.ListMessages(fixture.cal, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: fixture.secretID}))
	if err != nil || len(history.Msg.Messages) != 1 {
		t.Errorf("history for someone added later: %v %v", history, err)
	}
	fixture.send(t, fixture.bea, mentionOf(fixture.cal)+" welcome", "")
	if unread := fixture.unread(t, fixture.cal); unread != 1 {
		t.Fatalf("a mention in the channel: %d unread, want 1", unread)
	}

	all, err := svc.ListAllChannels(fixture.owner, connect.NewRequest(&chatv1.ListAllChannelsRequest{SpaceId: fixture.spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range all.Msg.Channels {
		switch row.Channel.Id {
		case fixture.secretID:
			if row.MemberCount != 2 || row.Joined {
				t.Errorf("the private channel in settings: %d people, joined %v", row.MemberCount, row.Joined)
			}
		case fixture.generalID:
			if row.MemberCount != 0 || !row.Joined {
				t.Errorf("a public channel in settings: %d people, joined %v", row.MemberCount, row.Joined)
			}
		}
	}
	if len(all.Msg.Channels) != 2 {
		t.Errorf("settings lists %d channels, want 2", len(all.Msg.Channels))
	}
	if _, err := svc.ListAllChannels(fixture.bea, connect.NewRequest(&chatv1.ListAllChannelsRequest{SpaceId: fixture.spaceID})); code(err) != connect.CodePermissionDenied {
		t.Errorf("settings list for a member: %v, want permission denied", err)
	}
	// An admin who is not in the private channel still orders every channel.
	if _, err := svc.ReorderChannels(fixture.owner, connect.NewRequest(&chatv1.ReorderChannelsRequest{
		SpaceId: fixture.spaceID, ChannelIds: []string{fixture.secretID, fixture.generalID},
	})); err != nil {
		t.Errorf("reorder by an admin outside the private channel: %v", err)
	}
	// Naming only the channels they can see works too, as the settings
	// page of someone who can't see the private channel does: it keeps
	// its place and the rest move around it.
	garden, err := svc.CreateChannel(fixture.owner, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: fixture.spaceID, Name: "garden"}))
	if err != nil {
		t.Fatal(err)
	}
	order := func() []string {
		res, err := svc.ListAllChannels(fixture.owner, connect.NewRequest(&chatv1.ListAllChannelsRequest{SpaceId: fixture.spaceID}))
		if err != nil {
			t.Fatal(err)
		}
		names := make([]string, len(res.Msg.Channels))
		for index, row := range res.Msg.Channels {
			names[index] = row.Channel.Name
		}
		return names
	}
	if _, err := svc.ReorderChannels(fixture.owner, connect.NewRequest(&chatv1.ReorderChannelsRequest{
		SpaceId: fixture.spaceID, ChannelIds: []string{fixture.secretID, fixture.generalID, garden.Msg.Channel.Id},
	})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReorderChannels(fixture.owner, connect.NewRequest(&chatv1.ReorderChannelsRequest{
		SpaceId: fixture.spaceID, ChannelIds: []string{garden.Msg.Channel.Id, fixture.generalID},
	})); err != nil {
		t.Errorf("reorder naming only the visible channels: %v", err)
	}
	if got := order(); len(got) != 3 || got[0] != "secret" || got[1] != "garden" || got[2] != "general" {
		t.Errorf("order after moving the visible channels: %v, want secret, garden, general", got)
	}
	// Leaving out a channel the caller can see is still refused.
	if _, err := svc.ReorderChannels(fixture.owner, connect.NewRequest(&chatv1.ReorderChannelsRequest{
		SpaceId: fixture.spaceID, ChannelIds: []string{fixture.generalID},
	})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("reorder leaving out a visible channel: %v, want invalid argument", err)
	}

	if _, err := svc.RemoveChannelMember(fixture.bea, connect.NewRequest(&chatv1.RemoveChannelMemberRequest{
		ChannelId: fixture.secretID, UserId: authctx.UserID(fixture.cal),
	})); code(err) != connect.CodePermissionDenied {
		t.Errorf("a member removing someone: %v, want permission denied", err)
	}
	received(added)
	if _, err := svc.RemoveChannelMember(fixture.owner, connect.NewRequest(&chatv1.RemoveChannelMemberRequest{
		ChannelId: fixture.secretID, UserId: authctx.UserID(fixture.cal),
	})); err != nil {
		t.Fatal(err)
	}
	if got := received(added); len(got) != 1 || got[0] != "channel_deleted" {
		t.Errorf("the person removed was sent %v, want the channel gone", got)
	}
	if unread := fixture.unread(t, fixture.cal); unread != 0 {
		t.Errorf("the person removed keeps %d alerts from the channel", unread)
	}
	if _, err := svc.ListMessages(fixture.cal, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: fixture.secretID})); code(err) != connect.CodeNotFound {
		t.Errorf("reading after removal: %v, want not found", err)
	}
	if _, err := svc.RemoveChannelMember(fixture.owner, connect.NewRequest(&chatv1.RemoveChannelMemberRequest{
		ChannelId: fixture.secretID, UserId: authctx.UserID(fixture.cal),
	})); code(err) != connect.CodeNotFound {
		t.Errorf("removing someone who is not in it: %v, want not found", err)
	}

	if _, err := svc.LeaveChannel(fixture.bea, connect.NewRequest(&chatv1.LeaveChannelRequest{ChannelId: fixture.generalID})); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("leaving a public channel: %v, want failed precondition", err)
	}
	if _, err := svc.LeaveChannel(fixture.bea, connect.NewRequest(&chatv1.LeaveChannelRequest{ChannelId: fixture.secretID})); err != nil {
		t.Fatal(err)
	}
	if ids, err := members(fixture.owner); err != nil || len(ids) != 0 {
		t.Errorf("after everyone left: %v %v", ids, err)
	}
}

// A webhook's bot goes into a private channel only for someone in it.
func TestAddBotToChannel(t *testing.T) {
	fixture := newPrivateFixture(t)
	bot := newUser(t, fixture.pool, "uptime", authctx.RoleMember)
	if err := fixture.svc.AddBotMember(fixture.owner, fixture.spaceID, authctx.UserID(bot)); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.svc.AddBotToChannel(fixture.owner, fixture.secretID, authctx.UserID(bot)); code(err) != connect.CodeNotFound {
		t.Errorf("by someone outside the channel: %v, want not found", err)
	}
	if added, err := fixture.svc.AddBotToChannel(fixture.bea, fixture.secretID, authctx.UserID(bot)); err != nil || !added {
		t.Fatalf("adding the bot: %v %v", added, err)
	}
	if added, err := fixture.svc.AddBotToChannel(fixture.bea, fixture.secretID, authctx.UserID(bot)); err != nil || added {
		t.Errorf("adding a bot already in it: %v %v", added, err)
	}
	if ok, err := fixture.svc.IsChannelMember(bot, authctx.UserID(bot), fixture.secretID); err != nil || !ok {
		t.Errorf("the bot is not in the channel: %v %v", ok, err)
	}
	if added, err := fixture.svc.AddBotToChannel(fixture.owner, fixture.generalID, authctx.UserID(bot)); err != nil || added {
		t.Errorf("a public channel needs nothing: %v %v", added, err)
	}
	// Undoing takes it out, and undoing twice is fine.
	for range 2 {
		if err := fixture.svc.RemoveBotFromChannel(fixture.bea, fixture.secretID, authctx.UserID(bot)); err != nil {
			t.Errorf("taking the bot back out: %v", err)
		}
	}
	if ok, err := fixture.svc.IsChannelMember(bot, authctx.UserID(bot), fixture.secretID); err != nil || ok {
		t.Errorf("the bot is still in the channel: %v %v", ok, err)
	}
}

// The activity list and its unread count follow who is in a private
// channel when they are read, so an alert written at the moment someone
// is removed shows them nothing.
func TestActivityFollowsPrivateChannelAccess(t *testing.T) {
	fixture := newPrivateFixture(t)
	fixture.add(t, fixture.owner)
	fixture.send(t, fixture.owner, mentionOf(fixture.bea)+" the flyer is out", "")
	listed := func() int {
		res, err := fixture.svc.ListActivity(fixture.bea, connect.NewRequest(&chatv1.ListActivityRequest{}))
		if err != nil {
			t.Fatal(err)
		}
		if int(res.Msg.UnreadCount) != len(res.Msg.Items) {
			t.Errorf("unread count %d, items %d", res.Msg.UnreadCount, len(res.Msg.Items))
		}
		return len(res.Msg.Items)
	}
	if got := listed(); got != 1 {
		t.Fatalf("in the channel: %d alerts, want 1", got)
	}
	// Take the row away without the cleanup a removal does, as an alert
	// that slipped in beside a removal would be left.
	fixture.remove(t, fixture.bea)
	if got := listed(); got != 0 {
		t.Errorf("out of the channel: %d alerts, want none", got)
	}
	fixture.add(t, fixture.bea)
	if got := listed(); got != 1 {
		t.Errorf("back in the channel: %d alerts, want 1", got)
	}
}

// A refusal never confirms that a private channel, or a message in one,
// exists: to someone outside it they read like an id that names nothing.
func TestRefusalsDoNotConfirmAPrivateChannel(t *testing.T) {
	fixture := newPrivateFixture(t)
	svc := fixture.svc
	messageID := fixture.send(t, fixture.bea, "the flyer", "")
	topic := "mine"
	onChannel := func(person context.Context, channelID string) []error {
		_, rename := svc.UpdateChannel(person, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: channelID, Topic: &topic}))
		_, add := svc.AddChannelMembers(person, connect.NewRequest(&chatv1.AddChannelMembersRequest{ChannelId: channelID, UserIds: []string{authctx.UserID(person)}}))
		_, remove := svc.RemoveChannelMember(person, connect.NewRequest(&chatv1.RemoveChannelMemberRequest{ChannelId: channelID, UserId: authctx.UserID(fixture.bea)}))
		_, people := svc.ListChannelMembers(person, connect.NewRequest(&chatv1.ListChannelMembersRequest{ChannelId: channelID}))
		_, gone := svc.DeleteChannel(person, connect.NewRequest(&chatv1.DeleteChannelRequest{ChannelId: channelID}))
		return []error{rename, add, remove, people, gone}
	}
	onMessage := func(person context.Context, id string) []error {
		_, pin := svc.SetMessagePinned(person, connect.NewRequest(&chatv1.SetMessagePinnedRequest{MessageId: id, Pinned: true}))
		_, gone := svc.DeleteMessage(person, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: id}))
		_, thread := svc.DeleteThread(person, connect.NewRequest(&chatv1.DeleteThreadRequest{MessageId: id}))
		return []error{pin, gone, thread}
	}
	same := func(what string, real, missing []error) {
		t.Helper()
		for index := range real {
			if code(real[index]) != connect.CodeNotFound || real[index].Error() != missing[index].Error() {
				t.Errorf("%s, call %d: %v for the private one, %v for one that does not exist", what, index, real[index], missing[index])
			}
		}
	}
	// cal is in the space with no rights; the owner manages channels but
	// is not in this one, so only the message calls are closed to them.
	same("a member outside, on the channel", onChannel(fixture.cal, fixture.secretID), onChannel(fixture.cal, uuid.NewString()))
	same("a member outside, on a message", onMessage(fixture.cal, messageID), onMessage(fixture.cal, uuid.NewString()))
	same("an admin outside, on a message", onMessage(fixture.owner, messageID), onMessage(fixture.owner, uuid.NewString()))

	// Someone in the channel without the right is told so plainly.
	if _, err := svc.UpdateChannel(fixture.bea, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: fixture.secretID, Topic: &topic})); code(err) != connect.CodePermissionDenied {
		t.Errorf("a member in the channel renaming it: %v, want permission denied", err)
	}
	if _, err := svc.UpdateChannel(fixture.cal, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: fixture.generalID, Topic: &topic})); code(err) != connect.CodePermissionDenied {
		t.Errorf("a member renaming a public channel: %v, want permission denied", err)
	}
}

// A private channel can't be made an announcement channel; a public one can.
func TestPrivateChannelCannotBeAnAnnouncementChannel(t *testing.T) {
	fixture := newPrivateFixture(t)
	fixture.add(t, fixture.owner)
	admins, everyone := chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS, chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_EVERYONE
	set := func(channelID string, policy chatv1.ChannelPostPolicy) error {
		_, err := fixture.svc.UpdateChannel(fixture.owner, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: channelID, PostPolicy: &policy}))
		return err
	}
	if err := set(fixture.secretID, admins); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("a private channel as an announcement channel: %v, want failed precondition", err)
	}
	// Everyone still posts there.
	fixture.send(t, fixture.bea, "still open", "")
	if err := set(fixture.secretID, everyone); err != nil {
		t.Errorf("setting a private channel to what it already is: %v", err)
	}
	if err := set(fixture.generalID, admins); err != nil {
		t.Errorf("a public channel as an announcement channel: %v", err)
	}
}

// A private voice channel: only its people may join it, the gateway is
// told it is private, and leaving or being removed reaches the SFU.
func TestPrivateVoiceChannel(t *testing.T) {
	fixture := newPrivateFixture(t)
	svc := fixture.svc
	rooms := &stubRooms{}
	svc.UseVoiceRooms(rooms)
	created, err := svc.CreateChannel(fixture.owner, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: fixture.spaceID, Name: "back-porch", Kind: chatv1.ChannelKind_CHANNEL_KIND_VOICE, Private: true,
	}))
	if err != nil {
		t.Fatal(err)
	}
	porch := created.Msg.Channel.Id
	ctx := context.Background()
	if spaceID, private, err := svc.VoiceChannelSpace(ctx, porch); err != nil || spaceID != fixture.spaceID || !private {
		t.Errorf("VoiceChannelSpace = %q, private %v, %v", spaceID, private, err)
	}
	beaID, calID := authctx.UserID(fixture.bea), authctx.UserID(fixture.cal)
	mayJoin := func(userID string) bool {
		t.Helper()
		member, err := svc.IsChannelMember(ctx, userID, porch)
		if err != nil {
			t.Fatal(err)
		}
		return member
	}
	if mayJoin(beaID) {
		t.Error("someone in the space but not the channel may join its voice")
	}
	if _, err := svc.AddChannelMembers(fixture.owner, connect.NewRequest(&chatv1.AddChannelMembersRequest{
		ChannelId: porch, UserIds: []string{beaID, calID},
	})); err != nil {
		t.Fatal(err)
	}
	if !mayJoin(beaID) {
		t.Error("someone in the channel may not join its voice")
	}

	if _, err := svc.RemoveChannelMember(fixture.owner, connect.NewRequest(&chatv1.RemoveChannelMemberRequest{
		ChannelId: porch, UserId: beaID,
	})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.LeaveChannel(fixture.cal, connect.NewRequest(&chatv1.LeaveChannelRequest{ChannelId: porch})); err != nil {
		t.Fatal(err)
	}
	if want := []string{porch + "/" + beaID, porch + "/" + calID}; !slices.Equal(rooms.removed, want) {
		t.Errorf("removed from the voice room: %v, want %v", rooms.removed, want)
	}
	if mayJoin(beaID) || mayJoin(calID) {
		t.Error("someone taken out of the channel may still join its voice")
	}

	// Taking someone out of a private text channel asks the SFU nothing.
	rooms.removed = nil
	if _, err := svc.AddChannelMembers(fixture.owner, connect.NewRequest(&chatv1.AddChannelMembersRequest{
		ChannelId: fixture.secretID, UserIds: []string{beaID},
	})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.LeaveChannel(fixture.bea, connect.NewRequest(&chatv1.LeaveChannelRequest{ChannelId: fixture.secretID})); err != nil {
		t.Fatal(err)
	}
	if len(rooms.removed) != 0 {
		t.Errorf("a text channel reached the SFU: %v", rooms.removed)
	}
}
