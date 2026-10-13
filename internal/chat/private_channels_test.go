package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/events"
)

// privateFixture is a space with a private channel: the owner and cal
// are in the space but not the channel, bea is in both.
type privateFixture struct {
	pool            *pgxpool.Pool
	bus             *events.InProcBus
	svc             *chat.Service
	owner, bea, cal context.Context
	spaceID         string
	generalID       string
	secretID        string
}

func newPrivateFixture(t *testing.T) privateFixture {
	t.Helper()
	pool, bus, svc := newTestService(t)
	fixture := privateFixture{
		pool: pool, bus: bus, svc: svc,
		owner: newUser(t, pool, "owner", authctx.RoleMember),
		bea:   newUser(t, pool, "bea", authctx.RoleMember),
		cal:   newUser(t, pool, "cal", authctx.RoleMember),
	}
	space, err := svc.CreateSpace(fixture.owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	fixture.spaceID, fixture.generalID = space.Msg.Space.Id, space.Msg.DefaultChannel.Id
	invite, err := svc.CreateInvite(fixture.owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: fixture.spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	for _, person := range []context.Context{fixture.bea, fixture.cal} {
		if _, err := svc.JoinSpace(person, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: invite.Msg.Invite.Code})); err != nil {
			t.Fatal(err)
		}
	}
	secret, err := svc.CreateChannel(fixture.owner, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: fixture.spaceID, Name: "secret", Kind: chatv1.ChannelKind_CHANNEL_KIND_TEXT,
	}))
	if err != nil {
		t.Fatal(err)
	}
	fixture.secretID = secret.Msg.Channel.Id
	if _, err := pool.Exec(context.Background(), "UPDATE channels SET private = true WHERE id = $1", fixture.secretID); err != nil {
		t.Fatal(err)
	}
	fixture.add(t, fixture.bea)
	return fixture
}

func (f privateFixture) add(t *testing.T, person context.Context) {
	t.Helper()
	if _, err := f.pool.Exec(context.Background(),
		"INSERT INTO channel_members (channel_id, space_id, user_id) VALUES ($1, $2, $3)",
		f.secretID, f.spaceID, authctx.UserID(person)); err != nil {
		t.Fatal(err)
	}
}

func (f privateFixture) remove(t *testing.T, person context.Context) {
	t.Helper()
	if _, err := f.pool.Exec(context.Background(),
		"DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2",
		f.secretID, authctx.UserID(person)); err != nil {
		t.Fatal(err)
	}
}

func (f privateFixture) send(t *testing.T, person context.Context, content, threadRootID string) string {
	t.Helper()
	res, err := f.svc.SendMessage(person, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: f.secretID, Content: content, ThreadRootId: threadRootID,
	}))
	if err != nil {
		t.Fatalf("send %q: %v", content, err)
	}
	return res.Msg.Message.Id
}

func (f privateFixture) unread(t *testing.T, person context.Context) int32 {
	t.Helper()
	list, err := f.svc.ListActivity(person, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	return list.Msg.UnreadCount
}

func TestPrivateChannelIsReadByItsPeopleOnly(t *testing.T) {
	fixture := newPrivateFixture(t)
	svc := fixture.svc
	messageID := fixture.send(t, fixture.bea, "the flyer is nearly done", "")

	lists := func(person context.Context) bool {
		res, err := svc.ListChannels(person, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: fixture.spaceID}))
		if err != nil {
			t.Fatal(err)
		}
		for _, channel := range res.Msg.Channels {
			if channel.Id == fixture.secretID {
				return true
			}
		}
		return false
	}
	if !lists(fixture.bea) {
		t.Error("someone in the channel does not see it listed")
	}
	for name, person := range map[string]context.Context{"cal": fixture.cal, "owner": fixture.owner} {
		if lists(person) {
			t.Errorf("%s is not in the channel and sees it listed", name)
		}
		if _, err := svc.ListMessages(person, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: fixture.secretID})); code(err) != connect.CodeNotFound {
			t.Errorf("%s reading: %v, want not found", name, err)
		}
		if _, err := svc.SendMessage(person, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: fixture.secretID, Content: "hi"})); code(err) != connect.CodeNotFound {
			t.Errorf("%s posting: %v, want not found", name, err)
		}
		if _, err := svc.ToggleReaction(person, connect.NewRequest(&chatv1.ToggleReactionRequest{MessageId: messageID, Emoji: "👍"})); code(err) != connect.CodeNotFound {
			t.Errorf("%s reacting: %v, want not found", name, err)
		}
		if _, err := svc.ListPinnedMessages(person, connect.NewRequest(&chatv1.ListPinnedMessagesRequest{ChannelId: fixture.secretID})); code(err) != connect.CodeNotFound {
			t.Errorf("%s listing pins: %v, want not found", name, err)
		}
		if ok, err := svc.IsChannelMember(person, authctx.UserID(person), fixture.secretID); err != nil || ok {
			t.Errorf("%s counts as a member of the channel: %v %v", name, ok, err)
		}
		// An id that names no channel reads the same as a private one.
		if _, err := svc.ListMessages(person, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: uuid.NewString()})); code(err) != connect.CodeNotFound {
			t.Errorf("%s reading a channel that does not exist: %v, want not found", name, err)
		}
	}
	if _, err := svc.ListMessages(fixture.bea, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: fixture.secretID})); err != nil {
		t.Errorf("someone in the channel reading: %v", err)
	}
}

func TestPrivateChannelSearch(t *testing.T) {
	fixture := newPrivateFixture(t)
	fixture.send(t, fixture.bea, "marmalade recipe", "")
	search := func(person context.Context, query string) (int, error) {
		res, err := fixture.svc.SearchMessages(person, connect.NewRequest(&chatv1.SearchMessagesRequest{
			Scope: &chatv1.SearchMessagesRequest_SpaceId{SpaceId: fixture.spaceID}, Query: query,
		}))
		if err != nil {
			return 0, err
		}
		return len(res.Msg.Messages), nil
	}
	if found, err := search(fixture.bea, "marmalade"); err != nil || found != 1 {
		t.Errorf("in the channel: %d results, %v", found, err)
	}
	if found, err := search(fixture.bea, "marmalade in:#secret"); err != nil || found != 1 {
		t.Errorf("in the channel, by name: %d results, %v", found, err)
	}
	if found, err := search(fixture.cal, "marmalade"); err != nil || found != 0 {
		t.Errorf("outside the channel: %d results, %v", found, err)
	}
	if _, err := search(fixture.cal, "marmalade in:#secret"); code(err) != connect.CodeNotFound {
		t.Errorf("outside the channel, by name: %v, want not found", err)
	}
}

func TestPrivateChannelModerationNeedsMembership(t *testing.T) {
	fixture := newPrivateFixture(t)
	svc := fixture.svc
	rootID := fixture.send(t, fixture.bea, "a root", "")
	fixture.send(t, fixture.bea, "a reply", rootID)
	otherID := fixture.send(t, fixture.bea, "another", "")

	pin := func() error {
		_, err := svc.SetMessagePinned(fixture.owner, connect.NewRequest(&chatv1.SetMessagePinnedRequest{MessageId: otherID, Pinned: true}))
		return err
	}
	deleteMessage := func() error {
		_, err := svc.DeleteMessage(fixture.owner, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: otherID}))
		return err
	}
	deleteThread := func() error {
		_, err := svc.DeleteThread(fixture.owner, connect.NewRequest(&chatv1.DeleteThreadRequest{MessageId: rootID}))
		return err
	}
	for name, act := range map[string]func() error{"pin": pin, "delete": deleteMessage, "delete thread": deleteThread} {
		if err := act(); code(err) != connect.CodeNotFound {
			t.Errorf("%s by an admin outside the channel: %v, want not found", name, err)
		}
	}
	fixture.add(t, fixture.owner)
	for _, step := range []struct {
		name string
		act  func() error
	}{{"pin", pin}, {"delete", deleteMessage}, {"delete thread", deleteThread}} {
		if err := step.act(); err != nil {
			t.Errorf("%s by an admin in the channel: %v", step.name, err)
		}
	}
}

func TestPrivateChannelMentionsReachItsPeople(t *testing.T) {
	fixture := newPrivateFixture(t)
	fixture.add(t, fixture.owner)

	fixture.send(t, fixture.bea, "@cal are you there", "")
	if unread := fixture.unread(t, fixture.cal); unread != 0 {
		t.Errorf("someone outside the channel was mentioned by name: %d unread", unread)
	}
	fixture.send(t, fixture.owner, "@channel flyer is out", "")
	if unread := fixture.unread(t, fixture.bea); unread != 1 {
		t.Errorf("someone in the channel after @channel: %d unread, want 1", unread)
	}
	if unread := fixture.unread(t, fixture.cal); unread != 0 {
		t.Errorf("someone outside the channel after @channel: %d unread", unread)
	}
}

func TestRemovedFromPrivateChannel(t *testing.T) {
	fixture := newPrivateFixture(t)
	svc := fixture.svc
	fixture.add(t, fixture.owner)
	rootID := fixture.send(t, fixture.owner, "a root", "")
	fixture.send(t, fixture.bea, "bea joins the thread", rootID)
	otherRootID := fixture.send(t, fixture.owner, "a thread bea mutes", "")
	fixture.send(t, fixture.owner, "its reply", otherRootID)
	if _, err := svc.SetThreadMuted(fixture.bea, connect.NewRequest(&chatv1.SetThreadMutedRequest{MessageId: otherRootID, Muted: true})); err != nil {
		t.Fatal(err)
	}
	before := fixture.unread(t, fixture.bea)

	fixture.remove(t, fixture.bea)
	fixture.send(t, fixture.owner, "a reply after bea was removed", rootID)
	if after := fixture.unread(t, fixture.bea); after != before {
		t.Errorf("thread activity reached someone removed from the channel: %d, was %d", after, before)
	}
	mutes, err := svc.ListThreadMutes(fixture.bea, connect.NewRequest(&chatv1.ListThreadMutesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(mutes.Msg.Threads) != 0 {
		t.Errorf("muted threads still list a thread from the channel: %d", len(mutes.Msg.Threads))
	}
}

func TestLeavingTheSpaceLeavesItsPrivateChannels(t *testing.T) {
	fixture := newPrivateFixture(t)
	fixture.add(t, fixture.owner)
	fixture.send(t, fixture.owner, "@bea the flyer is out", "")
	if unread := fixture.unread(t, fixture.bea); unread != 1 {
		t.Fatalf("a mention in the private channel: %d unread, want 1", unread)
	}
	if _, err := fixture.svc.KickMember(fixture.owner, connect.NewRequest(&chatv1.KickMemberRequest{
		SpaceId: fixture.spaceID, UserId: authctx.UserID(fixture.bea),
	})); err != nil {
		t.Fatal(err)
	}
	if unread := fixture.unread(t, fixture.bea); unread != 0 {
		t.Errorf("a kicked member keeps %d alerts from the private channel", unread)
	}
	var rows int
	if err := fixture.pool.QueryRow(context.Background(),
		"SELECT count(*) FROM channel_members WHERE user_id = $1", authctx.UserID(fixture.bea)).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Errorf("a kicked member keeps %d private channel rows", rows)
	}
}

func TestPrivateChannelAndSpaceSettings(t *testing.T) {
	fixture := newPrivateFixture(t)
	svc := fixture.svc
	if _, err := svc.UpdateSpace(fixture.owner, connect.NewRequest(&chatv1.UpdateSpaceRequest{
		SpaceId: fixture.spaceID, DefaultChannelId: &fixture.secretID,
	})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("private default channel: %v, want invalid argument", err)
	}
	// The one public channel can't go, though a private one exists.
	if _, err := svc.DeleteChannel(fixture.owner, connect.NewRequest(&chatv1.DeleteChannelRequest{ChannelId: fixture.generalID})); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("deleting the last public channel: %v, want failed precondition", err)
	}
	// A private channel is deleted from settings without joining it.
	if _, err := svc.DeleteChannel(fixture.owner, connect.NewRequest(&chatv1.DeleteChannelRequest{ChannelId: fixture.secretID})); err != nil {
		t.Errorf("deleting a private channel: %v", err)
	}
}

func TestPrivateChannelAttachmentsStayInTheirChannel(t *testing.T) {
	fixture := newPrivateFixture(t)
	fixture.svc.UseFiles(&dbFiles{pool: fixture.pool})
	upload := func(privateChannel bool) string {
		id := newFile(t, fixture.pool, fixture.bea, fixture.spaceID, "attachment", "flyer.txt")
		if privateChannel {
			if _, err := fixture.pool.Exec(context.Background(),
				"UPDATE files SET private_channel_id = $2 WHERE id = $1", id, fixture.secretID); err != nil {
				t.Fatal(err)
			}
		}
		return id
	}
	send := func(channelID, fileID string) error {
		_, err := fixture.svc.SendMessage(fixture.bea, connect.NewRequest(&chatv1.SendMessageRequest{
			ChannelId: channelID, AttachmentIds: []string{fileID},
		}))
		return err
	}
	if err := send(fixture.generalID, upload(true)); code(err) != connect.CodeInvalidArgument {
		t.Errorf("a private channel's file in a public channel: %v, want invalid argument", err)
	}
	if err := send(fixture.secretID, upload(false)); code(err) != connect.CodeInvalidArgument {
		t.Errorf("a public upload in a private channel: %v, want invalid argument", err)
	}
	if err := send(fixture.secretID, upload(true)); err != nil {
		t.Errorf("a private channel's file in its own channel: %v", err)
	}
	if err := send(fixture.generalID, upload(false)); err != nil {
		t.Errorf("a public upload in a public channel: %v", err)
	}
}

func TestUploadTargetSaysPrivate(t *testing.T) {
	fixture := newPrivateFixture(t)
	if _, private, err := fixture.svc.ChannelSpaceToPostIn(fixture.bea, authctx.UserID(fixture.bea), fixture.secretID); err != nil || !private {
		t.Errorf("someone in the channel: private %v, %v", private, err)
	}
	if _, private, err := fixture.svc.ChannelSpaceToPostIn(fixture.bea, authctx.UserID(fixture.bea), fixture.generalID); err != nil || private {
		t.Errorf("a public channel: private %v, %v", private, err)
	}
	if _, _, err := fixture.svc.ChannelSpaceToPostIn(fixture.cal, authctx.UserID(fixture.cal), fixture.secretID); code(err) != connect.CodeNotFound {
		t.Errorf("someone outside the channel: %v, want not found", err)
	}
}

// received drains what a subscription holds and names each event's kind.
func received(sub *events.Subscription) []string {
	var kinds []string
	for {
		select {
		case ev := <-sub.Events():
			switch ev.Payload.(type) {
			case *realtimev1.ServerEvent_MessageCreated:
				kinds = append(kinds, "message_created")
			case *realtimev1.ServerEvent_MessageUpdated:
				kinds = append(kinds, "message_updated")
			case *realtimev1.ServerEvent_MessageDeleted:
				kinds = append(kinds, "message_deleted")
			case *realtimev1.ServerEvent_ReactionsChanged:
				kinds = append(kinds, "reactions_changed")
			case *realtimev1.ServerEvent_ChannelUpdated:
				kinds = append(kinds, "channel_updated")
			case *realtimev1.ServerEvent_ChannelDeleted:
				kinds = append(kinds, "channel_deleted")
			case *realtimev1.ServerEvent_ChannelsReordered:
				kinds = append(kinds, "channels_reordered")
			default:
				kinds = append(kinds, "other")
			}
		default:
			return kinds
		}
	}
}

// A private channel's events go to its people's own topics. Nothing
// reaches the space's topic, which is what every member's connection and
// the outgoing webhook subscriber listen on.
func TestPrivateChannelEventsReachItsPeopleOnly(t *testing.T) {
	fixture := newPrivateFixture(t)
	svc := fixture.svc
	space := fixture.bus.Subscribe("space:" + fixture.spaceID)
	defer space.Close()
	inside := fixture.bus.Subscribe("user:" + authctx.UserID(fixture.bea))
	defer inside.Close()
	outside := fixture.bus.Subscribe("user:" + authctx.UserID(fixture.cal))
	defer outside.Close()

	expect := func(step string, want ...string) {
		t.Helper()
		if got := received(space); len(got) != 0 {
			t.Errorf("%s: the space was sent %v", step, got)
		}
		if got := received(outside); len(got) != 0 {
			t.Errorf("%s: someone outside the channel was sent %v", step, got)
		}
		got := received(inside)
		if len(got) != len(want) {
			t.Errorf("%s: someone in the channel was sent %v, want %v", step, got, want)
			return
		}
		for index := range want {
			if got[index] != want[index] {
				t.Errorf("%s: someone in the channel was sent %v, want %v", step, got, want)
				return
			}
		}
	}

	messageID := fixture.send(t, fixture.bea, "the flyer is nearly done", "")
	expect("send", "message_created")
	if _, err := svc.EditMessage(fixture.bea, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: messageID, Content: "the flyer is done"})); err != nil {
		t.Fatal(err)
	}
	expect("edit", "message_updated")
	if _, err := svc.ToggleReaction(fixture.bea, connect.NewRequest(&chatv1.ToggleReactionRequest{MessageId: messageID, Emoji: "👍"})); err != nil {
		t.Fatal(err)
	}
	expect("react", "reactions_changed")
	if _, err := svc.DeleteMessage(fixture.bea, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: messageID})); err != nil {
		t.Fatal(err)
	}
	expect("delete", "message_deleted")

	topic := "Keep it in here"
	if _, err := svc.UpdateChannel(fixture.owner, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: fixture.secretID, Topic: &topic})); err != nil {
		t.Fatal(err)
	}
	expect("retopic", "channel_updated")

	if people, listed, err := svc.ChannelPeople(context.Background(), fixture.secretID); err != nil || !listed || len(people) != 1 || people[0] != authctx.UserID(fixture.bea) {
		t.Errorf("the channel's people for typing: %v %v %v", people, listed, err)
	}
	if people, listed, err := svc.ChannelPeople(context.Background(), fixture.generalID); err != nil || listed || people != nil {
		t.Errorf("a public channel has no people list: %v %v %v", people, listed, err)
	}
	// A private channel with nobody in it, and an id that names no
	// channel, still have a people list: an empty one.
	fixture.remove(t, fixture.bea)
	if people, listed, err := svc.ChannelPeople(context.Background(), fixture.secretID); err != nil || !listed || len(people) != 0 {
		t.Errorf("an empty private channel: %v %v %v", people, listed, err)
	}
	if people, listed, err := svc.ChannelPeople(context.Background(), uuid.NewString()); err != nil || !listed || len(people) != 0 {
		t.Errorf("an id that names no channel: %v %v %v", people, listed, err)
	}
	fixture.add(t, fixture.bea)
	received(inside)

	if _, err := svc.DeleteChannel(fixture.owner, connect.NewRequest(&chatv1.DeleteChannelRequest{ChannelId: fixture.secretID})); err != nil {
		t.Fatal(err)
	}
	expect("delete channel", "channel_deleted")
}

// A reorder tells the space about its public channels and a private
// channel's people about theirs.
func TestReorderLeavesPrivateChannelsOutOfTheSpaceBroadcast(t *testing.T) {
	fixture := newPrivateFixture(t)
	fixture.add(t, fixture.owner)
	space := fixture.bus.Subscribe("space:" + fixture.spaceID)
	defer space.Close()
	inside := fixture.bus.Subscribe("user:" + authctx.UserID(fixture.bea))
	defer inside.Close()

	if _, err := fixture.svc.ReorderChannels(fixture.owner, connect.NewRequest(&chatv1.ReorderChannelsRequest{
		SpaceId: fixture.spaceID, ChannelIds: []string{fixture.secretID, fixture.generalID},
	})); err != nil {
		t.Fatal(err)
	}
	for {
		var ev *realtimev1.ServerEvent
		select {
		case ev = <-space.Events():
		default:
			t.Fatal("the space was not told about the reorder")
		}
		reordered := ev.GetChannelsReordered()
		if reordered == nil {
			continue
		}
		if len(reordered.Channels) != 1 || reordered.Channels[0].Id != fixture.generalID || reordered.Channels[0].Position != 1 {
			t.Errorf("the space broadcast: %v, want the public channel alone at position 1", reordered.Channels)
		}
		break
	}
	if got := received(inside); len(got) != 1 || got[0] != "channel_updated" {
		t.Errorf("someone in the private channel was sent %v, want its new position", got)
	}
}
