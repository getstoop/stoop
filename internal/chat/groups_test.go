package chat_test

import (
	"context"
	"errors"
	"slices"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	commonv1 "github.com/getstoop/stoop/gen/stoop/common/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
)

// groupFixture is the private-channel fixture, with the user directory
// that knows bots, and a group @@gardeners holding all three people.
type groupFixture struct {
	privateFixture
	groupID string
}

func newGroupFixture(t *testing.T) groupFixture {
	t.Helper()
	base := newPrivateFixture(t)
	base.svc = chat.New(base.pool, base.bus, botDirectory{base.pool})
	group, err := base.svc.CreateGroup(base.owner, connect.NewRequest(&chatv1.CreateGroupRequest{
		SpaceId: base.spaceID, Handle: "gardeners", Name: "Garden crew",
		UserIds: []string{authctx.UserID(base.owner), authctx.UserID(base.bea), authctx.UserID(base.cal)},
	}))
	if err != nil {
		t.Fatal(err)
	}
	return groupFixture{privateFixture: base, groupID: group.Msg.Group.Id}
}

func (f groupFixture) sendTo(t *testing.T, person context.Context, channelID, content string) *chatv1.Message {
	t.Helper()
	res, err := f.svc.SendMessage(person, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: content}))
	if err != nil {
		t.Fatalf("send %q: %v", content, err)
	}
	return res.Msg.Message
}

func (f groupFixture) groups(t *testing.T, person context.Context) []*chatv1.Group {
	t.Helper()
	list, err := f.svc.ListGroups(person, connect.NewRequest(&chatv1.ListGroupsRequest{SpaceId: f.spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	return list.Msg.Groups
}

// refusedField is the field a refusal names, or "" when it names none.
func refusedField(err error) string {
	var cerr *connect.Error
	if !errors.As(err, &cerr) {
		return ""
	}
	for _, detail := range cerr.Details() {
		if value, _ := detail.Value(); value != nil {
			if violation, ok := value.(*commonv1.FieldViolation); ok {
				return violation.Field
			}
		}
	}
	return ""
}

func TestGroupMentionReachesItsPeopleInPublicChannels(t *testing.T) {
	fixture := newGroupFixture(t)

	message := fixture.sendTo(t, fixture.bea, fixture.generalID, "compost Saturday @@Gardeners")
	want := []string{authctx.UserID(fixture.owner), authctx.UserID(fixture.cal)}
	if got := slices.Sorted(slices.Values(message.MentionUserIds)); !slices.Equal(got, slices.Sorted(slices.Values(want))) {
		t.Errorf("mention_user_ids = %v, want the owner and cal (not the author)", got)
	}
	if unread := fixture.unread(t, fixture.cal); unread != 1 {
		t.Errorf("cal after @@gardeners: %d unread, want 1", unread)
	}
	if unread := fixture.unread(t, fixture.bea); unread != 0 {
		t.Errorf("the author was told of their own mention: %d unread", unread)
	}

	// Named directly and through the group: one item, not two.
	fixture.sendTo(t, fixture.owner, fixture.generalID, "@cal and @@gardeners, gloves")
	if unread := fixture.unread(t, fixture.cal); unread != 2 {
		t.Errorf("cal after @cal plus @@gardeners: %d unread, want 2", unread)
	}

	// A single @ is a person's handle, and nobody is called gardeners.
	if got := fixture.sendTo(t, fixture.owner, fixture.generalID, "@gardeners hello").MentionUserIds; len(got) != 0 {
		t.Errorf("@gardeners reached %v; it names no person", got)
	}
}

func TestGroupAndPersonMayShareAHandle(t *testing.T) {
	fixture := newGroupFixture(t)
	if _, err := fixture.svc.CreateGroup(fixture.owner, connect.NewRequest(&chatv1.CreateGroupRequest{
		SpaceId: fixture.spaceID, Handle: "bea", Name: "Not Bea", UserIds: []string{authctx.UserID(fixture.cal)},
	})); err != nil {
		t.Fatalf("a group named like a person: %v", err)
	}
	message := fixture.sendTo(t, fixture.owner, fixture.generalID, "@bea and @@bea")
	want := []string{authctx.UserID(fixture.bea), authctx.UserID(fixture.cal)}
	if got := slices.Sorted(slices.Values(message.MentionUserIds)); !slices.Equal(got, slices.Sorted(slices.Values(want))) {
		t.Errorf("mention_user_ids = %v, want bea (the person) and cal (the group)", got)
	}
}

func TestGroupMentionDoesNothingInPrivateChannelsAndDMs(t *testing.T) {
	fixture := newGroupFixture(t)
	fixture.add(t, fixture.cal)

	if got := fixture.sendTo(t, fixture.bea, fixture.secretID, "@@gardeners in here").MentionUserIds; len(got) != 0 {
		t.Errorf("@@gardeners in a private channel reached %v", got)
	}
	dm, err := fixture.svc.OpenDirectMessage(fixture.bea, connect.NewRequest(&chatv1.OpenDirectMessageRequest{
		UserIds: []string{authctx.UserID(fixture.cal)},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if got := fixture.sendTo(t, fixture.bea, dm.Msg.DirectMessage.Channel.Id, "@@gardeners in a DM").MentionUserIds; len(got) != 0 {
		t.Errorf("@@gardeners in a DM reached %v", got)
	}
}

func TestGroupChanges(t *testing.T) {
	fixture := newGroupFixture(t)
	spaceEvents := fixture.bus.Subscribe("space:" + fixture.spaceID)
	defer spaceEvents.Close()

	if _, err := fixture.svc.CreateGroup(fixture.bea, connect.NewRequest(&chatv1.CreateGroupRequest{
		SpaceId: fixture.spaceID, Handle: "porch", Name: "Porch", UserIds: []string{authctx.UserID(fixture.bea)},
	})); code(err) != connect.CodePermissionDenied {
		t.Errorf("a member making a group: %v, want permission denied", err)
	}

	updated, err := fixture.svc.UpdateGroup(fixture.owner, connect.NewRequest(&chatv1.UpdateGroupRequest{
		GroupId: fixture.groupID, Handle: "growers", Name: "Growers", UserIds: []string{authctx.UserID(fixture.cal)},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if group := updated.Msg.Group; group.Handle != "growers" || group.Name != "Growers" ||
		!slices.Equal(group.UserIds, []string{authctx.UserID(fixture.cal)}) {
		t.Errorf("updated group = %+v", group)
	}
	if event := <-spaceEvents.Events(); event.GetGroupsChanged().GetSpaceId() != fixture.spaceID {
		t.Errorf("after an update the space heard %v, want groups_changed", event)
	}

	// Leaving the space takes cal out of the group; the group stays.
	if _, err := fixture.svc.LeaveSpace(fixture.cal, connect.NewRequest(&chatv1.LeaveSpaceRequest{SpaceId: fixture.spaceID})); err != nil {
		t.Fatal(err)
	}
	if groups := fixture.groups(t, fixture.bea); len(groups) != 1 || len(groups[0].UserIds) != 0 {
		t.Errorf("groups after cal left = %+v, want one group with nobody", groups)
	}

	if _, err := fixture.svc.DeleteGroup(fixture.owner, connect.NewRequest(&chatv1.DeleteGroupRequest{GroupId: fixture.groupID})); err != nil {
		t.Fatal(err)
	}
	if groups := fixture.groups(t, fixture.bea); len(groups) != 0 {
		t.Errorf("groups after delete = %+v", groups)
	}
}

func TestGroupRefusals(t *testing.T) {
	fixture := newGroupFixture(t)
	bea := authctx.UserID(fixture.bea)
	stranger := authctx.UserID(newUser(t, fixture.pool, "stranger", authctx.RoleMember))
	bot := newBot(t, fixture.pool, "sprinkler_bot")
	if _, err := fixture.pool.Exec(context.Background(),
		"INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, 'member')", fixture.spaceID, bot); err != nil {
		t.Fatal(err)
	}

	for _, refusal := range []struct {
		name, handle, groupName string
		userIDs                 []string
		field                   string
	}{
		{"taken in the space", "gardeners", "Again", []string{bea}, "handle"},
		{"taken in another case", "GARDENERS", "Again", []string{bea}, "handle"},
		{"reserved", "channel", "Everyone", []string{bea}, "handle"},
		{"hyphen", "front-porch", "Porch", []string{bea}, "handle"},
		{"too short", "ab", "Porch", []string{bea}, "handle"},
		{"no name", "porch", "  ", []string{bea}, "name"},
		{"name too long", "porch", "a name well over fifty characters long, as you can see", []string{bea}, "name"},
		{"nobody", "porch", "Porch", nil, "user_ids"},
		{"not in the space", "porch", "Porch", []string{bea, stranger}, "user_ids"},
		{"a bot", "porch", "Porch", []string{bea, bot}, "user_ids"},
	} {
		_, err := fixture.svc.CreateGroup(fixture.owner, connect.NewRequest(&chatv1.CreateGroupRequest{
			SpaceId: fixture.spaceID, Handle: refusal.handle, Name: refusal.groupName, UserIds: refusal.userIDs,
		}))
		if err == nil || refusedField(err) != refusal.field {
			t.Errorf("%s: %v, want a refusal on %s", refusal.name, err, refusal.field)
		}
	}
	if groups := fixture.groups(t, fixture.owner); len(groups) != 1 {
		t.Errorf("refusals left %d groups, want the fixture's one", len(groups))
	}
}
