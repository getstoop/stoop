package chat

import (
	"context"
	"fmt"
	"reflect"
	"slices"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

// Ceasing to be a member of a space records "left" in each private
// channel of it the person was in: docs/architecture/messaging.md →
// System messages.

// privateChannel is a private text channel ada makes, with these people
// added one by one in the order given.
func (f *systemRows) privateChannel(name string, members ...string) string {
	f.t.Helper()
	created, err := f.svc.CreateChannel(f.ada, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: f.spaceID, Name: name, Kind: chatv1.ChannelKind_CHANNEL_KIND_TEXT, Private: true,
	}))
	if err != nil {
		f.t.Fatal(err)
	}
	f.addTo(created.Msg.Channel.Id, members...)
	return created.Msg.Channel.Id
}

func (f *systemRows) addTo(channelID string, members ...string) {
	f.t.Helper()
	for _, member := range members {
		if _, err := f.svc.AddChannelMembers(f.ada, connect.NewRequest(&chatv1.AddChannelMembersRequest{
			ChannelId: channelID, UserIds: []string{member},
		})); err != nil {
			f.t.Fatal(err)
		}
	}
}

// leftRows are the "left" rows in a channel, by author, in seq order.
func (f *systemRows) leftRows(channelID string) []string {
	f.t.Helper()
	var authors []string
	for _, row := range f.systemRowsIn(channelID) {
		if row.kind == kindMemberLeft {
			authors = append(authors, row.authorID)
		}
	}
	return authors
}

// channelState is what a reader is told about one channel's unread.
type channelState struct {
	unread        int32
	lastMessageID string
	alerts        int32
}

// states is every channel reader sees in the space, and the space's own
// unread mark and alerts under "".
func (f *systemRows) states(reader context.Context) map[string]channelState {
	f.t.Helper()
	out := map[string]channelState{}
	channels, err := f.svc.ListChannels(reader, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: f.spaceID}))
	if err != nil {
		f.t.Fatal(err)
	}
	for _, channel := range channels.Msg.Channels {
		out[channel.Id] = channelState{channel.UnreadCount, channel.LastMessageId, channel.AlertCount}
	}
	spaces, err := f.svc.ListSpaces(reader, connect.NewRequest(&chatv1.ListSpacesRequest{}))
	if err != nil {
		f.t.Fatal(err)
	}
	for _, space := range spaces.Msg.Spaces {
		if space.Id == f.spaceID {
			unread := int32(0)
			if space.HasUnread {
				unread = 1
			}
			out[""] = channelState{unread: unread, alerts: space.AlertCount}
		}
	}
	return out
}

// departureHeard is what one subscription received about departures: the
// "left" rows by channel, and the channels it heard channel_member_left
// for.
type departureHeard struct {
	rows map[string]*chatv1.Message
	left []string
}

func hearDepartures(t *testing.T, sub *events.Subscription) departureHeard {
	t.Helper()
	out := departureHeard{rows: map[string]*chatv1.Message{}}
	for {
		select {
		case event := <-sub.Events():
			switch payload := event.Payload.(type) {
			case *realtimev1.ServerEvent_MessageCreated:
				message := payload.MessageCreated
				if message.Event.GetMemberLeft() == nil {
					t.Errorf("heard a message that is not a left row: %v", message)
					continue
				}
				if out.rows[message.ChannelId] != nil {
					t.Errorf("heard two left rows in channel %s", message.ChannelId)
				}
				out.rows[message.ChannelId] = message
			case *realtimev1.ServerEvent_ChannelMemberLeft:
				out.left = append(out.left, payload.ChannelMemberLeft.ChannelId)
			}
		case <-time.After(300 * time.Millisecond):
			slices.Sort(out.left)
			return out
		}
	}
}

// Every way of ceasing to be a member writes one "left" row, by the
// person who went, in each private channel they were in, text or voice,
// and none anywhere else. The rows reach the people who remain in each
// channel and no one else, and move no one's unread. A kick, a ban,
// leaving, an account deletion and a bot's removal all read the same.
func TestEveryDepartureRecordsLeft(t *testing.T) {
	causes := []struct {
		name   string
		bot    bool
		remove func(f *systemRows, leaverID string) error
	}{
		{"leave", false, func(f *systemRows, _ string) error {
			_, err := f.svc.LeaveSpace(f.cat, connect.NewRequest(&chatv1.LeaveSpaceRequest{SpaceId: f.spaceID}))
			return err
		}},
		{"kick", false, func(f *systemRows, leaverID string) error {
			_, err := f.svc.KickMember(f.ada, connect.NewRequest(&chatv1.KickMemberRequest{SpaceId: f.spaceID, UserId: leaverID}))
			return err
		}},
		{"ban", false, func(f *systemRows, leaverID string) error {
			_, err := f.svc.BanMember(f.ada, connect.NewRequest(&chatv1.BanMemberRequest{SpaceId: f.spaceID, UserId: leaverID, Reason: "spam"}))
			return err
		}},
		{"account deletion", false, func(f *systemRows, leaverID string) error {
			_, err := f.svc.RemovePerson(context.Background(), leaverID, "")
			return err
		}},
		{"bot removed", true, func(f *systemRows, leaverID string) error {
			return f.svc.RemoveBotMember(context.Background(), f.spaceID, leaverID)
		}},
	}
	for _, cause := range causes {
		t.Run(cause.name, func(t *testing.T) {
			fixture := newSystemRows(t)
			ctx := context.Background()
			adaID, beaID := authctx.UserID(fixture.ada), authctx.UserID(fixture.bea)
			leaverID := authctx.UserID(fixture.cat)
			if cause.bot {
				leaverID = uuid.NewString()
				if _, err := fixture.pool.Exec(ctx,
					`INSERT INTO users (id, username, display_name, role, kind) VALUES ($1, 'uptime', 'uptime', 'member', 'bot')`, leaverID); err != nil {
					t.Fatal(err)
				}
				if err := fixture.svc.AddBotMember(ctx, fixture.spaceID, leaverID); err != nil {
					t.Fatal(err)
				}
			}
			both := fixture.privateChannel("both", beaID)
			onlyAda := fixture.privateChannel("only-ada")
			without := fixture.privateChannel("without", beaID)
			voice := fixture.privateChannel("voice", beaID)
			if _, err := fixture.pool.Exec(ctx, `UPDATE channels SET kind = $2 WHERE id = $1`,
				voice, int16(chatv1.ChannelKind_CHANNEL_KIND_VOICE)); err != nil {
				t.Fatal(err)
			}
			theirs := []string{both, onlyAda, voice}
			for _, channelID := range theirs {
				if _, err := fixture.pool.Exec(ctx,
					`INSERT INTO channel_members (channel_id, space_id, user_id) VALUES ($1, $2, $3)`,
					channelID, fixture.spaceID, leaverID); err != nil {
					t.Fatal(err)
				}
			}
			// Something unread in a channel each of the others is in, so
			// a row that moved it would show.
			fixture.send(fixture.ada, &chatv1.SendMessageRequest{ChannelId: both, Content: "hello"})
			fixture.send(fixture.bea, &chatv1.SendMessageRequest{ChannelId: without, Content: "just us"})
			before := map[string]map[string]channelState{"ada": fixture.states(fixture.ada), "bea": fixture.states(fixture.bea)}

			bus := fixture.svc.bus.(*events.InProcBus)
			subs := map[string]*events.Subscription{
				"ada": bus.Subscribe(events.UserTopic(adaID)), "bea": bus.Subscribe(events.UserTopic(beaID)),
				"leaver": bus.Subscribe(events.UserTopic(leaverID)), "space": bus.Subscribe(events.SpaceTopic(fixture.spaceID)),
			}
			for _, sub := range subs {
				defer sub.Close()
			}

			if err := cause.remove(fixture, leaverID); err != nil {
				t.Fatal(err)
			}

			for _, channelID := range theirs {
				if got := fixture.leftRows(channelID); !reflect.DeepEqual(got, []string{leaverID}) {
					t.Errorf("left rows in %s = %v, want one by the person who went", channelID, got)
				}
			}
			for _, channelID := range []string{without, fixture.channel.ID} {
				if got := fixture.systemRowsIn(channelID); len(got) != 0 {
					t.Errorf("rows in %s, which they were not in or is public = %+v, want none", channelID, got)
				}
			}
			var data []byte
			if err := fixture.pool.QueryRow(ctx,
				`SELECT data FROM messages WHERE channel_id = $1 AND kind = $2`, both, kindMemberLeft).Scan(&data); err != nil {
				t.Fatal(err)
			}
			if string(data) != "{}" {
				t.Errorf("left row data = %s, want nothing about the cause", data)
			}

			// Who heard what: each remaining person, the row and the
			// leaving in each channel they share; the person who went
			// and the space, nothing of it.
			want := map[string][]string{"ada": theirs, "bea": {both, voice}}
			for name, channels := range want {
				got := hearDepartures(t, subs[name])
				var rows []string
				for channelID, message := range got.rows {
					rows = append(rows, channelID)
					if message.Author.GetId() != leaverID || !message.Quiet {
						t.Errorf("%s heard a row %v, want a quiet row by the person who went", name, message)
					}
				}
				slices.Sort(rows)
				expected := slices.Sorted(slices.Values(channels))
				if !reflect.DeepEqual(rows, expected) || !reflect.DeepEqual(got.left, expected) {
					t.Errorf("%s heard rows in %v and leavings in %v, want both in %v", name, rows, got.left, expected)
				}
			}
			for _, name := range []string{"leaver", "space"} {
				if got := hearDepartures(t, subs[name]); len(got.rows) != 0 || len(got.left) != 0 {
					t.Errorf("%s heard rows in %v and leavings in %v, want neither", name, got.rows, got.left)
				}
			}

			after := map[string]map[string]channelState{"ada": fixture.states(fixture.ada), "bea": fixture.states(fixture.bea)}
			if !reflect.DeepEqual(after, before) {
				t.Errorf("unread after = %+v, want %+v as before", after, before)
			}
		})
	}
}

// Someone in no private channel leaves no row anywhere.
func TestDepartureFromNoPrivateChannelRecordsNothing(t *testing.T) {
	fixture := newSystemRows(t)
	fixture.privateChannel("without", authctx.UserID(fixture.bea))
	if _, err := fixture.svc.KickMember(fixture.ada, connect.NewRequest(&chatv1.KickMemberRequest{
		SpaceId: fixture.spaceID, UserId: authctx.UserID(fixture.cat),
	})); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := fixture.pool.QueryRow(context.Background(), `SELECT count(*) FROM messages WHERE kind <> 0`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Errorf("%d system rows after a departure from no private channel, want none", count)
	}
}

// A removal that fails after its rows are written takes them back with
// it: the person is still in the space and its channels, and no row
// stays. A removal refused before it starts writes none either.
func TestFailedDepartureRecordsNothing(t *testing.T) {
	fixture := newSystemRows(t)
	ctx := context.Background()
	catID := authctx.UserID(fixture.cat)
	channelID := fixture.privateChannel("secret", catID)

	if _, err := fixture.svc.KickMember(fixture.bea, connect.NewRequest(&chatv1.KickMemberRequest{
		SpaceId: fixture.spaceID, UserId: catID,
	})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a member kicking: %v, want permission denied", err)
	}
	// The second row the removal writes fails, the first already in.
	second := fixture.privateChannel("second", catID)
	if _, err := fixture.pool.Exec(ctx, fmt.Sprintf(`
		CREATE FUNCTION refuse_left() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'refused'; END $$;
		CREATE TRIGGER refuse_left BEFORE INSERT ON messages
		FOR EACH ROW WHEN (NEW.kind = %d AND NEW.channel_id = '%s') EXECUTE FUNCTION refuse_left();`,
		kindMemberLeft, max(channelID, second))); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.svc.KickMember(fixture.ada, connect.NewRequest(&chatv1.KickMemberRequest{
		SpaceId: fixture.spaceID, UserId: catID,
	})); err == nil {
		t.Fatal("kick went through a refused row")
	}
	var count int
	if err := fixture.pool.QueryRow(ctx, `SELECT count(*) FROM messages WHERE kind <> 0`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Errorf("%d system rows after failed removals, want none", count)
	}
	for _, channel := range []string{channelID, second} {
		in, err := fixture.svc.q.IsPrivateChannelMember(ctx, dbgen.IsPrivateChannelMemberParams{ChannelID: channel, UserID: catID})
		if err != nil {
			t.Fatal(err)
		}
		if !in {
			t.Errorf("cat is out of %s after a failed removal", channel)
		}
	}
}

// Two people removed at once from a space where they share several
// private channels both go, each with a row in every one of them. They
// were added in opposite orders, so a removal that took the channels in
// the order it met them could wait on the other in a circle.
func TestConcurrentDeparturesDoNotDeadlock(t *testing.T) {
	fixture := newSystemRows(t)
	beaID, catID := authctx.UserID(fixture.bea), authctx.UserID(fixture.cat)
	var channels []string
	for index := range 6 {
		channels = append(channels, fixture.privateChannel(fmt.Sprintf("shared-%d", index)))
	}
	invite, err := fixture.svc.CreateInvite(fixture.ada, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: fixture.spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	const rounds = 8
	for round := range rounds {
		if round > 0 {
			for _, joiner := range []context.Context{fixture.bea, fixture.cat} {
				if _, err := fixture.svc.JoinSpace(joiner, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: invite.Msg.Invite.Code})); err != nil {
					t.Fatal(err)
				}
			}
		}
		for index := range channels {
			fixture.addTo(channels[index], beaID)
			fixture.addTo(channels[len(channels)-1-index], catID)
		}
		var wait sync.WaitGroup
		errs := make([]error, 2)
		start := make(chan struct{})
		wait.Add(2)
		go func() {
			defer wait.Done()
			<-start
			_, errs[0] = fixture.svc.LeaveSpace(fixture.bea, connect.NewRequest(&chatv1.LeaveSpaceRequest{SpaceId: fixture.spaceID}))
		}()
		go func() {
			defer wait.Done()
			<-start
			_, errs[1] = fixture.svc.KickMember(fixture.ada, connect.NewRequest(&chatv1.KickMemberRequest{SpaceId: fixture.spaceID, UserId: catID}))
		}()
		close(start)
		wait.Wait()
		for index, err := range errs {
			if err != nil {
				t.Fatalf("round %d, removal %d: %v", round, index, err)
			}
		}
	}
	for _, channelID := range channels {
		got := fixture.leftRows(channelID)
		var bea, cat int
		for _, author := range got {
			switch author {
			case beaID:
				bea++
			case catID:
				cat++
			}
		}
		if bea != rounds || cat != rounds || len(got) != 2*rounds {
			t.Errorf("channel %s: %d rows by bea and %d by cat of %d, want %d each", channelID, bea, cat, len(got), rounds)
		}
	}
}

// An account deleted leaves a row in every space it was in, sent with
// the person's name; read back once the account is marked deleted, the
// row's author reads as a deleted account.
func TestAccountDeletionLeavesAcrossSpaces(t *testing.T) {
	fixture := newSystemRows(t)
	ctx := context.Background()
	catID := authctx.UserID(fixture.cat)
	here := fixture.privateChannel("here", catID)

	other, err := fixture.svc.CreateSpace(fixture.ada, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Attic"}))
	if err != nil {
		t.Fatal(err)
	}
	invite, err := fixture.svc.CreateInvite(fixture.ada, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: other.Msg.Space.Id}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.svc.JoinSpace(fixture.cat, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: invite.Msg.Invite.Code})); err != nil {
		t.Fatal(err)
	}
	there, err := fixture.svc.CreateChannel(fixture.ada, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: other.Msg.Space.Id, Name: "there", Kind: chatv1.ChannelKind_CHANNEL_KIND_TEXT, Private: true,
	}))
	if err != nil {
		t.Fatal(err)
	}
	fixture.addTo(there.Msg.Channel.Id, catID)

	bus := fixture.svc.bus.(*events.InProcBus)
	ada := bus.Subscribe(events.UserTopic(authctx.UserID(fixture.ada)))
	defer ada.Close()
	if _, err := fixture.svc.RemovePerson(ctx, catID, ""); err != nil {
		t.Fatal(err)
	}
	heardRows := hearDepartures(t, ada).rows
	for _, channelID := range []string{here, there.Msg.Channel.Id} {
		if got := fixture.leftRows(channelID); !reflect.DeepEqual(got, []string{catID}) {
			t.Errorf("left rows in %s = %v, want one by cat", channelID, got)
		}
		sent := heardRows[channelID]
		if sent.GetAuthor().GetUsername() != "cat" || sent.GetAuthor().GetDeleted() {
			t.Errorf("row sent in %s by %v, want cat as cat still was", channelID, sent.GetAuthor())
		}
	}

	if _, err := fixture.pool.Exec(ctx, `UPDATE users SET deleted_at = now(), deactivated_at = now() WHERE id = $1`, catID); err != nil {
		t.Fatal(err)
	}
	read := fixture.load(heardRows[here].GetId())
	if !read.Author.GetDeleted() || read.Event.GetMemberLeft() == nil {
		t.Errorf("row read after the deletion = %v, want a left row by a deleted account", read)
	}
}
