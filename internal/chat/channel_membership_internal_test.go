package chat

import (
	"context"
	"fmt"
	"reflect"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

// A private channel records who was added and who left:
// docs/architecture/messaging.md → System messages.

// privateRoom makes the fixture's channel a new private channel holding
// members, ada (who makes it) only when she is among them.
func (f *systemRows) privateRoom(members ...context.Context) {
	f.t.Helper()
	created, err := f.svc.CreateChannel(f.ada, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: f.spaceID, Name: "back-room", Private: true,
	}))
	if err != nil {
		f.t.Fatal(err)
	}
	f.channel = f.channelRow(created.Msg.Channel.Id)
	if _, err := f.pool.Exec(context.Background(),
		"DELETE FROM channel_members WHERE channel_id = $1", f.channel.ID); err != nil {
		f.t.Fatal(err)
	}
	for _, member := range members {
		f.putIn(member)
	}
}

// putIn adds person to the channel behind the service's back, recording
// nothing.
func (f *systemRows) putIn(person context.Context) {
	f.t.Helper()
	if _, err := f.pool.Exec(context.Background(),
		"INSERT INTO channel_members (channel_id, space_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
		f.channel.ID, f.spaceID, authctx.UserID(person)); err != nil {
		f.t.Fatal(err)
	}
}

// joiner is someone new in the space.
func (f *systemRows) joiner(name string) context.Context {
	f.t.Helper()
	person := authctx.WithIdentity(context.Background(),
		authctx.Identity{UserID: dbtest.NewUser(f.t, f.pool, name, "member"), Role: authctx.RoleMember})
	invite, err := f.svc.CreateInvite(f.ada, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: f.spaceID}))
	if err != nil {
		f.t.Fatal(err)
	}
	if _, err := f.svc.JoinSpace(person, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: invite.Msg.Invite.Code})); err != nil {
		f.t.Fatal(err)
	}
	return person
}

func (f *systemRows) addPeople(actor context.Context, people ...context.Context) error {
	f.t.Helper()
	_, err := f.svc.AddChannelMembers(actor, connect.NewRequest(&chatv1.AddChannelMembersRequest{
		ChannelId: f.channel.ID, UserIds: ids(people...),
	}))
	return err
}

func (f *systemRows) removePerson(actor, person context.Context) error {
	f.t.Helper()
	_, err := f.svc.RemoveChannelMember(actor, connect.NewRequest(&chatv1.RemoveChannelMemberRequest{
		ChannelId: f.channel.ID, UserId: authctx.UserID(person),
	}))
	return err
}

func (f *systemRows) leave(person context.Context) error {
	f.t.Helper()
	_, err := f.svc.LeaveChannel(person, connect.NewRequest(&chatv1.LeaveChannelRequest{ChannelId: f.channel.ID}))
	return err
}

func ids(people ...context.Context) []string {
	out := make([]string, len(people))
	for index, person := range people {
		out[index] = authctx.UserID(person)
	}
	return out
}

// added is the stored row for actor adding people.
func added(actor context.Context, people ...context.Context) storedRow {
	members := make([]any, len(people))
	for index, id := range ids(people...) {
		members[index] = id
	}
	return storedRow{kind: kindMembersAdded, authorID: authctx.UserID(actor), data: map[string]any{"user_ids": members}}
}

// left is the stored row for person leaving: nothing besides them.
func left(person context.Context) storedRow {
	return storedRow{kind: kindMemberLeft, authorID: authctx.UserID(person), data: map[string]any{}}
}

// One call records one row naming only the people it put in; a call that
// puts nobody in records nothing. Making the channel records nothing.
func TestAddChannelMembersRecordsWhoWasAdded(t *testing.T) {
	fixture := newSystemRows(t)
	created, err := fixture.svc.CreateChannel(fixture.ada, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: fixture.spaceID, Name: "back-room", Private: true,
	}))
	if err != nil {
		t.Fatal(err)
	}
	fixture.channel = fixture.channelRow(created.Msg.Channel.Id)
	if got := fixture.systemRowsIn(fixture.channel.ID); len(got) != 0 {
		t.Fatalf("making a private channel recorded %+v, want nothing", got)
	}
	dan, eve, fay, gus := fixture.joiner("dan"), fixture.joiner("eve"), fixture.joiner("fay"), fixture.joiner("gus")
	steps := []struct {
		people []context.Context
		want   *storedRow
	}{
		{[]context.Context{fixture.bea}, new(added(fixture.ada, fixture.bea))},
		// bea is in already, and ada made it.
		{[]context.Context{fixture.bea, fixture.cat, fixture.ada, dan}, new(added(fixture.ada, fixture.cat, dan))},
		{[]context.Context{fixture.bea, fixture.cat}, nil},
		{[]context.Context{eve, fay, gus, eve}, new(added(fixture.ada, eve, fay, gus))},
	}
	var want []storedRow
	for index, step := range steps {
		if err := fixture.addPeople(fixture.ada, step.people...); err != nil {
			t.Fatalf("step %d: %v", index, err)
		}
		if step.want != nil {
			want = append(want, *step.want)
		}
		if got := fixture.systemRowsIn(fixture.channel.ID); !reflect.DeepEqual(got, want) {
			t.Fatalf("after step %d rows = %+v, want %+v", index, got, want)
		}
	}
}

// An admin outside the channel who adds only themself is the row's
// author and its only member, which the clients read as "joined".
func TestAdminAddingThemselfJoins(t *testing.T) {
	fixture := newSystemRows(t)
	fixture.privateRoom(fixture.bea)
	if err := fixture.addPeople(fixture.ada, fixture.ada); err != nil {
		t.Fatal(err)
	}
	want := []storedRow{added(fixture.ada, fixture.ada)}
	if got := fixture.systemRowsIn(fixture.channel.ID); !reflect.DeepEqual(got, want) {
		t.Errorf("rows = %+v, want %+v", got, want)
	}
}

// Leaving and being removed record the same row, by the person who went;
// nothing names who removed them. Someone not in the channel records
// nothing.
func TestLeavingAndRemovalRecordLeft(t *testing.T) {
	fixture := newSystemRows(t)
	fixture.privateRoom(fixture.ada, fixture.bea, fixture.cat)
	if err := fixture.leave(fixture.bea); err != nil {
		t.Fatal(err)
	}
	if err := fixture.removePerson(fixture.ada, fixture.cat); err != nil {
		t.Fatal(err)
	}
	if err := fixture.removePerson(fixture.ada, fixture.cat); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("removing someone already out: %v, want not found", err)
	}
	if err := fixture.leave(fixture.cat); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("leaving a channel one is not in: %v, want not found", err)
	}
	want := []storedRow{left(fixture.bea), left(fixture.cat)}
	if got := fixture.systemRowsIn(fixture.channel.ID); !reflect.DeepEqual(got, want) {
		t.Errorf("rows = %+v, want %+v", got, want)
	}
}

// A webhook's bot is added by the person making the hook and leaves as
// itself; adding it twice or taking it out twice records once.
func TestBotInPrivateChannelIsRecorded(t *testing.T) {
	fixture := newSystemRows(t)
	fixture.privateRoom(fixture.ada, fixture.bea)
	bot := fixture.joiner("uptime")
	for range 2 {
		if _, err := fixture.svc.AddBotToChannel(fixture.bea, fixture.channel.ID, authctx.UserID(bot)); err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		if err := fixture.svc.RemoveBotFromChannel(fixture.bea, fixture.channel.ID, authctx.UserID(bot)); err != nil {
			t.Fatal(err)
		}
	}
	want := []storedRow{added(fixture.bea, bot), left(bot)}
	if got := fixture.systemRowsIn(fixture.channel.ID); !reflect.DeepEqual(got, want) {
		t.Errorf("rows = %+v, want %+v", got, want)
	}
}

// refuseSystemRows makes writing any system message fail.
func (f *systemRows) refuseSystemRows() {
	f.t.Helper()
	if _, err := f.pool.Exec(context.Background(), `
		CREATE FUNCTION refuse_system_row() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.kind <> 0 THEN RAISE EXCEPTION 'refused by the test'; END IF;
			RETURN NEW;
		END $$;
		CREATE TRIGGER refuse_system_row BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION refuse_system_row();`); err != nil {
		f.t.Fatal(err)
	}
}

func (f *systemRows) members() []string {
	f.t.Helper()
	members, err := f.svc.q.ListPrivateChannelMemberIDs(context.Background(), f.channel.ID)
	if err != nil {
		f.t.Fatal(err)
	}
	return members
}

// An action whose row cannot be written does not happen: nobody is put
// in or taken out, and nobody is told.
func TestFailedMembershipChangeRecordsNothing(t *testing.T) {
	fixture := newSystemRows(t)
	fixture.privateRoom(fixture.ada, fixture.bea)
	bus := fixture.svc.bus.(*events.InProcBus)
	bea := bus.Subscribe(events.UserTopic(authctx.UserID(fixture.bea)))
	defer bea.Close()
	cat := bus.Subscribe(events.UserTopic(authctx.UserID(fixture.cat)))
	defer cat.Close()
	before := fixture.members()
	fixture.refuseSystemRows()

	if err := fixture.addPeople(fixture.ada, fixture.cat); err == nil {
		t.Error("adding with the row refused succeeded")
	}
	if _, err := fixture.svc.AddBotToChannel(fixture.ada, fixture.channel.ID, authctx.UserID(fixture.cat)); err == nil {
		t.Error("adding a bot with the row refused succeeded")
	}
	if err := fixture.removePerson(fixture.ada, fixture.bea); err == nil {
		t.Error("removing with the row refused succeeded")
	}
	if err := fixture.leave(fixture.bea); err == nil {
		t.Error("leaving with the row refused succeeded")
	}
	if got := fixture.members(); !reflect.DeepEqual(got, before) {
		t.Errorf("members after refused changes = %v, want %v", got, before)
	}
	if got := fixture.systemRowsIn(fixture.channel.ID); len(got) != 0 {
		t.Errorf("rows after refused changes = %+v", got)
	}
	for name, sub := range map[string]*events.Subscription{"bea": bea, "cat": cat} {
		if got := membershipHeard(t, sub); len(got) != 0 {
			t.Errorf("%s heard %v after refused changes", name, got)
		}
	}
}

// membershipHeard is what a subscription receives within a moment, by
// payload kind.
func membershipHeard(t *testing.T, sub *events.Subscription) []string {
	t.Helper()
	var kinds []string
	for {
		select {
		case event := <-sub.Events():
			switch payload := event.Payload.(type) {
			case *realtimev1.ServerEvent_ChannelCreated:
				kinds = append(kinds, "channel_created")
			case *realtimev1.ServerEvent_ChannelDeleted:
				kinds = append(kinds, "channel_deleted")
			case *realtimev1.ServerEvent_ChannelMemberJoined:
				kinds = append(kinds, "member_joined")
			case *realtimev1.ServerEvent_ChannelMemberLeft:
				kinds = append(kinds, "member_left")
			case *realtimev1.ServerEvent_MessageCreated:
				kinds = append(kinds, rowKind(payload.MessageCreated))
			default:
				kinds = append(kinds, "other")
			}
		case <-time.After(300 * time.Millisecond):
			return kinds
		}
	}
}

// rowKind names a created message by what it records.
func rowKind(message *chatv1.Message) string {
	switch {
	case message.Event.GetMembersAdded() != nil:
		names := ""
		for _, member := range message.Event.GetMembersAdded().Members {
			names += " " + member.Username
		}
		return fmt.Sprintf("%s added%s", message.Author.GetUsername(), names)
	case message.Event.GetMemberLeft() != nil:
		return message.Author.GetUsername() + " left"
	default:
		return "message"
	}
}

// The "added" row reaches the people in the channel, a new member only
// after the channel itself; the "left" row reaches the people who remain
// and not the person who went. Nobody outside hears either.
func TestMembershipRowsArePublished(t *testing.T) {
	fixture := newSystemRows(t)
	fixture.privateRoom(fixture.ada, fixture.bea)
	dan := fixture.joiner("dan")
	bus := fixture.svc.bus.(*events.InProcBus)
	subscribe := func(person context.Context) *events.Subscription {
		sub := bus.Subscribe(events.UserTopic(authctx.UserID(person)))
		t.Cleanup(sub.Close)
		return sub
	}
	ada, bea, cat, outside := subscribe(fixture.ada), subscribe(fixture.bea), subscribe(fixture.cat), subscribe(dan)
	space := bus.Subscribe(events.SpaceTopic(fixture.spaceID))
	defer space.Close()
	expect := func(step string, sub *events.Subscription, want ...string) {
		t.Helper()
		if got := membershipHeard(t, sub); !reflect.DeepEqual(got, want) {
			t.Errorf("%s: heard %v, want %v", step, got, want)
		}
	}

	if err := fixture.addPeople(fixture.ada, fixture.cat); err != nil {
		t.Fatal(err)
	}
	expect("cat added, to cat", cat, "channel_created", "member_joined", "ada added cat")
	expect("cat added, to bea", bea, "member_joined", "ada added cat")
	expect("cat added, to ada", ada, "member_joined", "ada added cat")

	if err := fixture.removePerson(fixture.ada, fixture.cat); err != nil {
		t.Fatal(err)
	}
	expect("cat removed, to cat", cat, "channel_deleted")
	expect("cat removed, to bea", bea, "member_left", "cat left")

	if err := fixture.leave(fixture.bea); err != nil {
		t.Fatal(err)
	}
	expect("bea left, to bea", bea, "channel_deleted")
	expect("bea left, to ada", ada, "member_left", "cat left", "member_left", "bea left")

	expect("someone outside", outside)
	expect("the space", space)
}

// Membership rows mark nothing unread for anyone in the channel
// throughout, the person who added or removed included.
func TestMembershipRowsMarkNothingUnread(t *testing.T) {
	fixture := newSystemRows(t)
	fixture.privateRoom(fixture.ada, fixture.bea)
	fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "hello"})
	before := map[string]readerState{"ada": fixture.state(fixture.ada), "bea": fixture.state(fixture.bea)}
	if before["ada"].unread != 1 {
		t.Fatalf("ada before = %+v, want one unread", before["ada"])
	}
	if err := fixture.addPeople(fixture.ada, fixture.cat); err != nil {
		t.Fatal(err)
	}
	cat := fixture.state(fixture.cat)
	if err := fixture.removePerson(fixture.ada, fixture.cat); err != nil {
		t.Fatal(err)
	}
	if err := fixture.addPeople(fixture.ada, fixture.cat); err != nil {
		t.Fatal(err)
	}
	if got := fixture.state(fixture.cat); got != cat {
		t.Errorf("cat added again = %+v, want %+v as when first added", got, cat)
	}
	if err := fixture.leave(fixture.cat); err != nil {
		t.Fatal(err)
	}
	for name, reader := range map[string]context.Context{"ada": fixture.ada, "bea": fixture.bea} {
		if got := fixture.state(reader); got != before[name] {
			t.Errorf("%s after the changes = %+v, want %+v as before", name, got, before[name])
		}
	}
}

// Removing someone while they send does not deadlock: the removal takes
// the channel row before their membership and activity, as the send does.
func TestRemovalDuringASendDoesNotDeadlock(t *testing.T) {
	fixture := newSystemRows(t)
	fixture.privateRoom(fixture.ada, fixture.bea)
	for round := range 20 {
		fixture.putIn(fixture.bea)
		// Alerts for bea in the channel, which her send marks read and
		// the removal deletes.
		for range 3 {
			fixture.send(fixture.ada, &chatv1.SendMessageRequest{Content: "<@u:" + authctx.UserID(fixture.bea) + ":bea> hi"})
		}
		sender, stopSend := context.WithTimeout(fixture.bea, 10*time.Second)
		remover, stopRemove := context.WithTimeout(fixture.ada, 10*time.Second)
		var wg sync.WaitGroup
		var sendErr, removeErr error
		wg.Go(func() {
			_, sendErr = fixture.svc.SendMessage(sender, connect.NewRequest(&chatv1.SendMessageRequest{
				ChannelId: fixture.channel.ID, Content: fmt.Sprintf("round %d", round),
			}))
		})
		wg.Go(func() {
			removeErr = fixture.removePerson(remover, fixture.bea)
		})
		wg.Wait()
		stopSend()
		stopRemove()
		if removeErr != nil {
			t.Fatalf("round %d: removal: %v", round, removeErr)
		}
		// The send either went first or found her gone.
		if sendErr != nil && connect.CodeOf(sendErr) != connect.CodeNotFound {
			t.Fatalf("round %d: send: %v", round, sendErr)
		}
	}
}
