package chat

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/proto"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

// Nothing in the service records a system message yet, so these tests
// call recordEvent the way an action will: in a transaction that holds
// the channel row first.

// tableUsers reads users from the table, deleted accounts included.
type tableUsers struct{ pool *pgxpool.Pool }

func (users tableUsers) GetUsers(ctx context.Context, ids []string) ([]UserRecord, error) {
	rows, err := users.pool.Query(ctx,
		`SELECT id, username, deleted_at IS NOT NULL FROM users WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UserRecord
	for rows.Next() {
		var record UserRecord
		if err := rows.Scan(&record.ID, &record.Username, &record.Deleted); err != nil {
			return nil, err
		}
		out = append(out, record)
	}
	return out, rows.Err()
}

// tableFiles reads attachments from the files table.
type tableFiles struct{ pool *pgxpool.Pool }

func (files tableFiles) GetFiles(ctx context.Context, ids []string) ([]FileRecord, error) {
	rows, err := files.pool.Query(ctx,
		`SELECT id, kind, owner_id, COALESCE(space_id::text, ''), name FROM files WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FileRecord
	for rows.Next() {
		var record FileRecord
		if err := rows.Scan(&record.ID, &record.Kind, &record.OwnerID, &record.SpaceID, &record.Name); err != nil {
			return nil, err
		}
		out = append(out, record)
	}
	return out, rows.Err()
}

func (tableFiles) DeleteFiles(context.Context, []string) error { return nil }

// systemRows is a space ada owns with bea and cat in it, and its default
// channel.
type systemRows struct {
	t             *testing.T
	pool          *pgxpool.Pool
	svc           *Service
	ada, bea, cat context.Context
	spaceID       string
	channel       dbgen.Channel
}

func newSystemRows(t *testing.T) *systemRows {
	t.Helper()
	pool := dbtest.New(t)
	svc := New(pool, events.NewInProcBus(), tableUsers{pool})
	svc.UseFiles(tableFiles{pool})
	person := func(name string) context.Context {
		return authctx.WithIdentity(context.Background(),
			authctx.Identity{UserID: dbtest.NewUser(t, pool, name, "member"), Role: authctx.RoleMember})
	}
	fixture := &systemRows{t: t, pool: pool, svc: svc, ada: person("ada"), bea: person("bea"), cat: person("cat")}
	space, err := svc.CreateSpace(fixture.ada, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	fixture.spaceID = space.Msg.Space.Id
	invite, err := svc.CreateInvite(fixture.ada, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: fixture.spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	for _, joiner := range []context.Context{fixture.bea, fixture.cat} {
		if _, err := svc.JoinSpace(joiner, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: invite.Msg.Invite.Code})); err != nil {
			t.Fatal(err)
		}
	}
	fixture.channel = fixture.channelRow(space.Msg.DefaultChannel.Id)
	return fixture
}

func (f *systemRows) channelRow(channelID string) dbgen.Channel {
	f.t.Helper()
	channel, err := f.svc.q.GetChannel(context.Background(), channelID)
	if err != nil {
		f.t.Fatal(err)
	}
	return channel
}

func (f *systemRows) send(ctx context.Context, req *chatv1.SendMessageRequest) *chatv1.Message {
	f.t.Helper()
	if req.ChannelId == "" {
		req.ChannelId = f.channel.ID
	}
	res, err := f.svc.SendMessage(ctx, connect.NewRequest(req))
	if err != nil {
		f.t.Fatal(err)
	}
	return res.Msg.Message
}

// record writes event into channel by actor, as an action would.
func (f *systemRows) record(actor context.Context, channel dbgen.Channel, event systemEvent) messageRow {
	f.t.Helper()
	var row messageRow
	err := f.svc.inTx(context.Background(), func(qtx *dbgen.Queries) error {
		if _, err := qtx.LockChannel(context.Background(), channel.ID); err != nil {
			return err
		}
		var err error
		row, err = recordEvent(context.Background(), qtx, channel, authctx.UserID(actor), event)
		return err
	})
	if err != nil {
		f.t.Fatal(err)
	}
	return row
}

// load is one message as a client is sent it.
func (f *systemRows) load(messageID string) *chatv1.Message {
	f.t.Helper()
	message, err := f.svc.loadMessage(context.Background(), messageID, f.spaceID)
	if err != nil {
		f.t.Fatal(err)
	}
	return message
}

// readerState is everything a reader is told about whether the channel
// and its space hold something new.
type readerState struct {
	unread         int32
	lastMessageID  string
	channelAlerts  int32
	spaceHasUnread bool
	spaceAlerts    int32
}

func (f *systemRows) state(ctx context.Context) readerState {
	f.t.Helper()
	var state readerState
	channels, err := f.svc.ListChannels(ctx, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: f.spaceID}))
	if err != nil {
		f.t.Fatal(err)
	}
	for _, channel := range channels.Msg.Channels {
		if channel.Id == f.channel.ID {
			state.unread, state.lastMessageID, state.channelAlerts = channel.UnreadCount, channel.LastMessageId, channel.AlertCount
		}
	}
	spaces, err := f.svc.ListSpaces(ctx, connect.NewRequest(&chatv1.ListSpacesRequest{}))
	if err != nil {
		f.t.Fatal(err)
	}
	for _, space := range spaces.Msg.Spaces {
		if space.Id == f.spaceID {
			state.spaceHasUnread, state.spaceAlerts = space.HasUnread, space.AlertCount
		}
	}
	return state
}

// everyKind is one event of each kind, about message.
func everyKind(memberID, messageID string) []systemEvent {
	return []systemEvent{
		membersAdded{UserIDs: []string{memberID}},
		memberLeft{},
		channelRenamed{OldName: "general", NewName: "porch"},
		topicChanged{Topic: "Friday nights"},
		messagePinned{MessageID: messageID},
		postPolicyChanged{PostPolicy: postPolicyAdmins},
	}
}

func messageIDs(messages []*chatv1.Message) []string {
	out := make([]string, len(messages))
	for index, message := range messages {
		out[index] = message.Id
	}
	return out
}

// A system row pages and syncs like a message: ListMessages and
// ListChanges return it in its place, with its event, quiet and the
// message it is about.
func TestSystemRowsReadInSeqOrder(t *testing.T) {
	fixture := newSystemRows(t)
	adaID, beaID := authctx.UserID(fixture.ada), authctx.UserID(fixture.bea)
	first := fixture.send(fixture.ada, &chatv1.SendMessageRequest{Content: "house rules"})
	renamed := fixture.record(fixture.ada, fixture.channel, channelRenamed{OldName: "general", NewName: "porch"})
	second := fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "hello"})
	pinned := fixture.record(fixture.ada, fixture.channel, messagePinned{MessageID: first.Id})
	added := fixture.record(fixture.ada, fixture.channel, membersAdded{UserIDs: []string{beaID}})

	if renamed.Kind != kindChannelRenamed || !renamed.Quiet || renamed.Content != "" || !renamed.InChannel ||
		renamed.ReplyToMessageID != nil || renamed.ThreadRootID != nil || renamed.AuthorID != adaID {
		t.Errorf("recorded row = %+v, want a quiet top-level row by ada with no text", renamed)
	}
	if renamed.Seq <= first.Seq || second.Seq <= renamed.Seq || pinned.Seq <= second.Seq || added.Seq <= pinned.Seq {
		t.Errorf("seqs = %d %d %d %d %d, want each above the last", first.Seq, renamed.Seq, second.Seq, pinned.Seq, added.Seq)
	}
	if got := fixture.channelRow(fixture.channel.ID).Seq; got != added.Seq {
		t.Errorf("channel seq = %d, want the last row's %d", got, added.Seq)
	}

	want := []string{first.Id, renamed.ID, second.Id, pinned.ID, added.ID}
	check := func(source string, messages []*chatv1.Message) {
		t.Helper()
		if got := messageIDs(messages); fmt.Sprint(got) != fmt.Sprint(want) {
			t.Fatalf("%s: ids = %v, want %v", source, got, want)
		}
		for _, index := range []int{0, 2} {
			if message := messages[index]; message.Event != nil || message.Quiet || message.Reference != nil {
				t.Errorf("%s: message %d = event %v quiet %v reference %v, want none on a message someone wrote",
					source, index, message.Event, message.Quiet, message.Reference)
			}
		}
		for _, index := range []int{1, 3, 4} {
			if message := messages[index]; !message.Quiet || message.Content != "" || message.Author.GetId() != adaID {
				t.Errorf("%s: system row %d = quiet %v content %q author %s, want quiet, no text, by ada",
					source, index, message.Quiet, message.Content, message.Author.GetId())
			}
		}
		if event := messages[1].Event.GetChannelRenamed(); event.GetOldName() != "general" || event.GetNewName() != "porch" || messages[1].Reference != nil {
			t.Errorf("%s: rename row = %v, reference %v", source, messages[1].Event, messages[1].Reference)
		}
		reference := messages[3].Reference
		if messages[3].Event.GetPin() == nil || reference.GetMessageId() != first.Id ||
			reference.GetAuthor().GetId() != adaID || reference.GetPreview() != "house rules" {
			t.Errorf("%s: pin row = %v, reference %v", source, messages[3].Event, reference)
		}
		if members := messages[4].Event.GetMembersAdded().GetMembers(); len(members) != 1 || members[0].Id != beaID || members[0].Username != "bea" {
			t.Errorf("%s: added row = %v", source, messages[4].Event)
		}
	}
	listed, err := fixture.svc.ListMessages(fixture.bea, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: fixture.channel.ID}))
	if err != nil {
		t.Fatal(err)
	}
	check("ListMessages", listed.Msg.Messages)
	changes, err := fixture.svc.ListChanges(fixture.bea, connect.NewRequest(&chatv1.ListChangesRequest{ChannelId: fixture.channel.ID}))
	if err != nil {
		t.Fatal(err)
	}
	check("ListChanges", changes.Msg.Messages)
	for index := 1; index < len(changes.Msg.Messages); index++ {
		if changes.Msg.Messages[index].Seq <= changes.Msg.Messages[index-1].Seq {
			t.Errorf("ListChanges: seq %d after %d", changes.Msg.Messages[index].Seq, changes.Msg.Messages[index-1].Seq)
		}
	}
	// From the middle of the log, only what came after.
	later, err := fixture.svc.ListChanges(fixture.bea, connect.NewRequest(&chatv1.ListChangesRequest{ChannelId: fixture.channel.ID, SinceSeq: second.Seq}))
	if err != nil {
		t.Fatal(err)
	}
	if got := messageIDs(later.Msg.Messages); fmt.Sprint(got) != fmt.Sprint(want[3:]) {
		t.Errorf("ListChanges since %d: ids = %v, want %v", second.Seq, got, want[3:])
	}
}

// Every kind is stored with its data and read back as its own case; a
// kind that carries nothing stores an empty object.
func TestEveryKindReadsBack(t *testing.T) {
	fixture := newSystemRows(t)
	beaID := authctx.UserID(fixture.bea)
	message := fixture.send(fixture.ada, &chatv1.SendMessageRequest{Content: "house rules"})
	wants := []struct {
		event *chatv1.SystemEvent
		data  string
	}{
		{&chatv1.SystemEvent{Kind: &chatv1.SystemEvent_MembersAdded{MembersAdded: &chatv1.MembersAdded{
			Members: []*chatv1.MessageAuthor{{Id: beaID, Username: "bea"}},
		}}}, `{"user_ids": ["` + beaID + `"]}`},
		{&chatv1.SystemEvent{Kind: &chatv1.SystemEvent_MemberLeft{MemberLeft: &chatv1.MemberLeft{}}}, `{}`},
		{&chatv1.SystemEvent{Kind: &chatv1.SystemEvent_ChannelRenamed{
			ChannelRenamed: &chatv1.ChannelRenamed{OldName: "general", NewName: "porch"},
		}}, `{"new_name": "porch", "old_name": "general"}`},
		{&chatv1.SystemEvent{Kind: &chatv1.SystemEvent_TopicChanged{TopicChanged: &chatv1.TopicChanged{Topic: "Friday nights"}}}, `{"topic": "Friday nights"}`},
		{&chatv1.SystemEvent{Kind: &chatv1.SystemEvent_Pin{Pin: &chatv1.PinEvent{}}}, `{}`},
		{&chatv1.SystemEvent{Kind: &chatv1.SystemEvent_PostPolicyChanged{PostPolicyChanged: &chatv1.PostPolicyChanged{
			PostPolicy: chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS,
		}}}, `{"post_policy": "admins"}`},
	}
	events := everyKind(beaID, message.Id)
	if len(events) != len(systemKinds) || len(wants) != len(systemKinds) {
		t.Fatalf("the test covers %d kinds, the registry holds %d", len(events), len(systemKinds))
	}
	for index, event := range events {
		row := fixture.record(fixture.ada, fixture.channel, event)
		var kind int16
		var data string
		if err := fixture.pool.QueryRow(context.Background(), `SELECT kind, data::text FROM messages WHERE id = $1`, row.ID).Scan(&kind, &data); err != nil {
			t.Fatal(err)
		}
		if kind != event.kind() || data != wants[index].data {
			t.Errorf("kind %d: stored kind %d data %s, want %s", event.kind(), kind, data, wants[index].data)
		}
		if !row.Quiet || !systemKinds[event.kind()].quiet {
			t.Errorf("kind %d: quiet = %v, want every kind quiet", event.kind(), row.Quiet)
		}
		if got := fixture.load(row.ID); !proto.Equal(got.Event, wants[index].event) {
			t.Errorf("kind %d: event = %v, want %v", event.kind(), got.Event, wants[index].event)
		}
	}
}

// unregistered is an event whose kind the registry does not hold.
type unregistered struct{ memberLeft }

func (unregistered) kind() int16 { return 99 }

// A kind outside the registry is never written, and one already in the
// table (a newer server wrote it) reads as an event with no case, which
// a client hides while it is quiet.
func TestUnknownKinds(t *testing.T) {
	fixture := newSystemRows(t)
	err := fixture.svc.inTx(context.Background(), func(qtx *dbgen.Queries) error {
		_, err := recordEvent(context.Background(), qtx, fixture.channel, authctx.UserID(fixture.ada), unregistered{})
		return err
	})
	if err == nil {
		t.Error("recordEvent wrote a kind the registry does not hold")
	}
	var rowID string
	if err := fixture.pool.QueryRow(context.Background(),
		`INSERT INTO messages (id, channel_id, author_id, content, seq, kind, data, quiet)
		 VALUES (gen_random_uuid(), $1, $2, '', 1, 99, '{"later": true}', true) RETURNING id`,
		fixture.channel.ID, authctx.UserID(fixture.ada)).Scan(&rowID); err != nil {
		t.Fatal(err)
	}
	if got := fixture.load(rowID); got.Event == nil || got.Event.Kind != nil || !got.Quiet {
		t.Errorf("unknown kind = event %v quiet %v, want an event with no case, quiet", got.Event, got.Quiet)
	}
}

// A quiet row changes nothing a reader is told: not the unread count,
// the channel's last message, the space's unread mark or the alert
// counts, for the actor, for someone with unread messages and for
// someone who never opened the channel. Pinning someone's message does
// not alert them.
func TestQuietRowsMarkNothingUnread(t *testing.T) {
	fixture := newSystemRows(t)
	mine := fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "who has the key?"})
	reply := fixture.send(fixture.ada, &chatv1.SendMessageRequest{Content: "I do", ReplyToMessageId: mine.Id})
	readers := map[string]context.Context{"ada": fixture.ada, "bea": fixture.bea, "cat": fixture.cat}
	before := map[string]readerState{}
	for name, reader := range readers {
		before[name] = fixture.state(reader)
	}
	if got, want := before["bea"], (readerState{unread: 1, lastMessageID: reply.Id, channelAlerts: 1, spaceHasUnread: true, spaceAlerts: 1}); got != want {
		t.Fatalf("bea before = %+v, want %+v", got, want)
	}
	if got, want := before["ada"], (readerState{lastMessageID: reply.Id}); got != want {
		t.Fatalf("ada before = %+v, want %+v", got, want)
	}
	if got, want := before["cat"], (readerState{unread: 2, lastMessageID: reply.Id, spaceHasUnread: true}); got != want {
		t.Fatalf("cat before = %+v, want %+v", got, want)
	}

	for _, event := range everyKind(authctx.UserID(fixture.cat), mine.Id) {
		fixture.record(fixture.ada, fixture.channel, event)
	}
	fixture.record(fixture.bea, fixture.channel, memberLeft{})
	for name, reader := range readers {
		if got := fixture.state(reader); got != before[name] {
			t.Errorf("%s after seven quiet rows = %+v, want %+v as before", name, got, before[name])
		}
	}

	// Marking read lands on the last message, below the trailing quiet
	// rows, and that is everything read.
	if _, err := fixture.svc.MarkChannelRead(fixture.bea, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: fixture.channel.ID})); err != nil {
		t.Fatal(err)
	}
	if got, want := fixture.state(fixture.bea), (readerState{lastMessageID: reply.Id}); got != want {
		t.Errorf("bea after reading = %+v, want %+v", got, want)
	}
	fixture.record(fixture.ada, fixture.channel, topicChanged{Topic: ""})
	if got, want := fixture.state(fixture.bea), (readerState{lastMessageID: reply.Id}); got != want {
		t.Errorf("bea after a quiet row on a read channel = %+v, want %+v", got, want)
	}

	// A delete recomputes the channel's last message past the quiet rows.
	if _, err := fixture.svc.DeleteMessage(fixture.ada, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: reply.Id})); err != nil {
		t.Fatal(err)
	}
	if got := fixture.state(fixture.cat); got.lastMessageID != mine.Id || got.unread != 1 {
		t.Errorf("cat after the delete = %+v, want last message %s and 1 unread", got, mine.Id)
	}
}

// has_unread on a space reads channels.last_message_id, which a quiet
// row never becomes: a space with nothing unread stays that way, and a
// channel holding only quiet rows has no last message at all.
func TestQuietRowLeavesTheSpaceRead(t *testing.T) {
	fixture := newSystemRows(t)
	for _, event := range everyKind(authctx.UserID(fixture.cat), "") {
		fixture.record(fixture.ada, fixture.channel, event)
	}
	for name, reader := range map[string]context.Context{"ada": fixture.ada, "bea": fixture.bea} {
		if got := fixture.state(reader); got != (readerState{}) {
			t.Errorf("%s in a channel of quiet rows = %+v, want nothing unread and no last message", name, got)
		}
	}
	message := fixture.send(fixture.ada, &chatv1.SendMessageRequest{Content: "hello"})
	if _, err := fixture.svc.MarkChannelRead(fixture.bea, connect.NewRequest(&chatv1.MarkChannelReadRequest{ChannelId: fixture.channel.ID})); err != nil {
		t.Fatal(err)
	}
	fixture.record(fixture.ada, fixture.channel, channelRenamed{OldName: "general", NewName: "porch"})
	if got, want := fixture.state(fixture.bea), (readerState{lastMessageID: message.Id}); got != want {
		t.Errorf("bea = %+v, want %+v", got, want)
	}
}

// The conversation list counts unread as the channel list does.
func TestQuietRowsInAConversation(t *testing.T) {
	fixture := newSystemRows(t)
	opened, err := fixture.svc.OpenDirectMessage(fixture.ada, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: []string{authctx.UserID(fixture.bea)}}))
	if err != nil {
		t.Fatal(err)
	}
	conversation := fixture.channelRow(opened.Msg.DirectMessage.Channel.Id)
	message := fixture.send(fixture.ada, &chatv1.SendMessageRequest{ChannelId: conversation.ID, Content: "see you saturday"})
	fixture.record(fixture.ada, conversation, topicChanged{Topic: "Saturday"})
	listed, err := fixture.svc.ListDirectMessages(fixture.bea, connect.NewRequest(&chatv1.ListDirectMessagesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Msg.DirectMessages) != 1 {
		t.Fatalf("bea lists %d conversations, want 1", len(listed.Msg.DirectMessages))
	}
	if channel := listed.Msg.DirectMessages[0].Channel; channel.UnreadCount != 1 || channel.LastMessageId != message.Id {
		t.Errorf("conversation = %d unread, last message %s; want 1 and %s", channel.UnreadCount, channel.LastMessageId, message.Id)
	}
}

// Search returns only messages someone wrote: not a system row whose
// data holds the word, not one with text an older server let its author
// write, and not one matched by a query of nothing but negations, which
// matches a row with no text.
func TestSearchNeverReturnsSystemRows(t *testing.T) {
	fixture := newSystemRows(t)
	message := fixture.send(fixture.ada, &chatv1.SendMessageRequest{Content: "livekit is up"})
	fixture.record(fixture.ada, fixture.channel, channelRenamed{OldName: "livekit", NewName: "voice"})
	edited := fixture.record(fixture.ada, fixture.channel, topicChanged{Topic: "livekit"})
	if _, err := fixture.pool.Exec(context.Background(), `UPDATE messages SET content = 'livekit again' WHERE id = $1`, edited.ID); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{"livekit", "-zebra", "-zebra -yak"} {
		found, err := fixture.svc.SearchMessages(fixture.bea, connect.NewRequest(&chatv1.SearchMessagesRequest{
			Scope: &chatv1.SearchMessagesRequest_SpaceId{SpaceId: fixture.spaceID}, Query: query,
		}))
		if err != nil {
			t.Fatalf("search %q: %v", query, err)
		}
		if got := messageIDs(found.Msg.Messages); fmt.Sprint(got) != fmt.Sprint([]string{message.Id}) {
			t.Errorf("search %q = %v, want only the message %s", query, got, message.Id)
		}
	}
}

// System rows expire with the messages around them.
func TestRetentionSweepsSystemRows(t *testing.T) {
	fixture := newSystemRows(t)
	fixture.svc.UseInstancePolicy(fixedRetention(30))
	message := fixture.send(fixture.ada, &chatv1.SendMessageRequest{Content: "house rules"})
	for _, event := range everyKind(authctx.UserID(fixture.bea), message.Id) {
		fixture.record(fixture.ada, fixture.channel, event)
	}
	if removed, err := fixture.svc.SweepMessages(context.Background(), time.Now()); err != nil || removed != 0 {
		t.Fatalf("sweep inside retention = %d, %v; want nothing", removed, err)
	}
	removed, err := fixture.svc.SweepMessages(context.Background(), time.Now().AddDate(0, 0, 31))
	if err != nil {
		t.Fatal(err)
	}
	if want := int64(1 + len(systemKinds)); removed != want {
		t.Errorf("sweep removed %d rows, want %d", removed, want)
	}
	var left int
	if err := fixture.pool.QueryRow(context.Background(), `SELECT count(*) FROM messages WHERE channel_id = $1`, fixture.channel.ID).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Errorf("%d rows left in the channel, want none", left)
	}
}

// The table refuses a row whose kind, data and reference disagree.
func TestSystemRowConstraints(t *testing.T) {
	fixture := newSystemRows(t)
	message := fixture.send(fixture.ada, &chatv1.SendMessageRequest{Content: "house rules"})
	missing := uuid.NewString()
	cases := []struct {
		name       string
		kind       int16
		data       *string
		reference  *string
		constraint string
	}{
		{"a system row with no data", kindMemberLeft, nil, nil, "messages_kind_has_data"},
		{"a written message with data", 0, new("{}"), nil, "messages_kind_has_data"},
		{"a written message with a reference", 0, nil, &message.Id, "messages_reference_needs_kind"},
		{"a reference to no message", kindMessagePinned, new("{}"), &missing, "messages_reference_message_id_fkey"},
		{"a system row with empty data", kindMemberLeft, new("{}"), nil, ""},
		{"a system row about a message", kindMessagePinned, new("{}"), &message.Id, ""},
		{"a written message", 0, nil, nil, ""},
	}
	for _, testCase := range cases {
		_, err := fixture.pool.Exec(context.Background(),
			`INSERT INTO messages (id, channel_id, author_id, content, seq, kind, data, reference_message_id)
			 VALUES (gen_random_uuid(), $1, $2, '', 1, $3, $4::jsonb, $5)`,
			fixture.channel.ID, authctx.UserID(fixture.ada), testCase.kind, testCase.data, testCase.reference)
		var refused *pgconn.PgError
		switch {
		case testCase.constraint == "" && err != nil:
			t.Errorf("%s: refused: %v", testCase.name, err)
		case testCase.constraint != "" && (!errors.As(err, &refused) || refused.ConstraintName != testCase.constraint):
			t.Errorf("%s: err = %v, want a violation of %s", testCase.name, err, testCase.constraint)
		}
	}
}

// The people in an event and the author of the message it is about are
// resolved when the row is read, so a rename, a deleted account and a
// deleted message all show as they are now.
func TestSystemRowPeopleAndReference(t *testing.T) {
	fixture := newSystemRows(t)
	ctx := context.Background()
	adaID, beaID, catID := authctx.UserID(fixture.ada), authctx.UserID(fixture.bea), authctx.UserID(fixture.cat)
	stranger := uuid.NewString()

	added := fixture.record(fixture.ada, fixture.channel, membersAdded{UserIDs: []string{beaID, catID, stranger}})
	if _, err := fixture.pool.Exec(ctx, `UPDATE users SET deactivated_at = now(), deleted_at = now() WHERE id = $1`, catID); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.pool.Exec(ctx, `UPDATE users SET username = 'beatrix' WHERE id = $1`, beaID); err != nil {
		t.Fatal(err)
	}
	members := fixture.load(added.ID).Event.GetMembersAdded().GetMembers()
	if len(members) != 3 {
		t.Fatalf("members = %v, want three", members)
	}
	if members[0].Id != beaID || members[0].Username != "beatrix" || members[0].Deleted {
		t.Errorf("renamed member = %v, want beatrix", members[0])
	}
	if members[1].Id != catID || !members[1].Deleted {
		t.Errorf("deleted member = %v, want cat marked deleted", members[1])
	}
	if members[2].Id != stranger || members[2].Username != "unknown" {
		t.Errorf("unknown member = %v, want the placeholder", members[2])
	}

	// The excerpt reads a mention as the person's current handle.
	written := fixture.send(fixture.ada, &chatv1.SendMessageRequest{Content: "<@u:" + beaID + ":bea> brings chairs"})
	aboutText := fixture.record(fixture.bea, fixture.channel, messagePinned{MessageID: written.Id})
	reference := fixture.load(aboutText.ID).Reference
	if reference.GetMessageId() != written.Id || reference.GetAuthor().GetId() != adaID ||
		!strings.Contains(reference.GetPreview(), "beatrix") || !strings.Contains(reference.GetPreview(), "brings chairs") {
		t.Errorf("reference = %v, want ada's message naming beatrix", reference)
	}

	// A message with no text is previewed by its first file.
	fileID := uuid.NewString()
	sum := sha256.Sum256([]byte(fileID))
	if _, err := fixture.pool.Exec(ctx,
		`INSERT INTO files (id, kind, owner_id, space_id, content_type, size, sha256, storage_key, name)
		 VALUES ($1, 'attachment', $2, $3, 'image/jpeg', 12, $4, $5, 'porch.jpg')`,
		fileID, adaID, fixture.spaceID, sum[:], "attachment/"+fileID); err != nil {
		t.Fatal(err)
	}
	photo := fixture.send(fixture.ada, &chatv1.SendMessageRequest{AttachmentIds: []string{fileID}})
	aboutPhoto := fixture.record(fixture.bea, fixture.channel, messagePinned{MessageID: photo.Id})
	if reference := fixture.load(aboutPhoto.ID).Reference; reference.GetPreview() != "📎 porch.jpg" || reference.GetAuthor().GetId() != adaID {
		t.Errorf("reference to a photo = %v, want its file name", reference)
	}

	// A deleted message leaves only its id; the row still says what
	// happened.
	if _, err := fixture.svc.DeleteMessage(fixture.ada, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: written.Id})); err != nil {
		t.Fatal(err)
	}
	afterDelete := fixture.load(aboutText.ID)
	if afterDelete.Event.GetPin() == nil || afterDelete.Reference.GetMessageId() != written.Id ||
		afterDelete.Reference.GetAuthor() != nil || afterDelete.Reference.GetPreview() != "" {
		t.Errorf("row about a deleted message = event %v reference %v, want the id alone", afterDelete.Event, afterDelete.Reference)
	}

	// Once the row is gone for good (the retention sweep), so is the
	// reference.
	if _, err := fixture.pool.Exec(ctx, `DELETE FROM messages WHERE id = $1`, photo.Id); err != nil {
		t.Fatal(err)
	}
	afterSweep := fixture.load(aboutPhoto.ID)
	if afterSweep.Event.GetPin() == nil || afterSweep.Reference != nil {
		t.Errorf("row about a swept message = event %v reference %v, want no reference", afterSweep.Event, afterSweep.Reference)
	}
}
