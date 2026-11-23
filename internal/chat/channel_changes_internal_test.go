package chat

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/events"
)

// UpdateChannel records a system message for each value it changes:
// docs/architecture/messaging.md → System messages.

// storedRow is a system row as the table holds it.
type storedRow struct {
	kind     int16
	authorID string
	data     map[string]any
}

// systemRowsIn are channelID's system rows in seq order.
func (f *systemRows) systemRowsIn(channelID string) []storedRow {
	f.t.Helper()
	rows, err := f.pool.Query(context.Background(),
		`SELECT kind, author_id, data FROM messages WHERE channel_id = $1 AND kind <> 0 ORDER BY seq`, channelID)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rows.Close()
	var out []storedRow
	for rows.Next() {
		var row storedRow
		var data []byte
		if err := rows.Scan(&row.kind, &row.authorID, &data); err != nil {
			f.t.Fatal(err)
		}
		if err := json.Unmarshal(data, &row.data); err != nil {
			f.t.Fatal(err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		f.t.Fatal(err)
	}
	return out
}

func (f *systemRows) update(actor context.Context, req *chatv1.UpdateChannelRequest) error {
	f.t.Helper()
	if req.ChannelId == "" {
		req.ChannelId = f.channel.ID
	}
	_, err := f.svc.UpdateChannel(actor, connect.NewRequest(req))
	return err
}

func TestUpdateChannelRecordsEachChange(t *testing.T) {
	everyone := chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_EVERYONE
	admins := chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS
	cases := []struct {
		name string
		req  *chatv1.UpdateChannelRequest
		want []storedRow
	}{
		{"rename", &chatv1.UpdateChannelRequest{Name: new("porch")},
			[]storedRow{{kind: kindChannelRenamed, data: map[string]any{"old_name": "general", "new_name": "porch"}}}},
		{"set a topic", &chatv1.UpdateChannelRequest{Topic: new("Friday nights")},
			[]storedRow{{kind: kindTopicChanged, data: map[string]any{"topic": "Friday nights"}}}},
		{"announcement on", &chatv1.UpdateChannelRequest{PostPolicy: &admins},
			[]storedRow{{kind: kindPostPolicyChanged, data: map[string]any{"post_policy": "admins"}}}},
		{"nothing changed", &chatv1.UpdateChannelRequest{Name: new("general"), Topic: new(""), PostPolicy: &everyone}, nil},
		{"name and topic", &chatv1.UpdateChannelRequest{Name: new("porch"), Topic: new("Friday nights")},
			[]storedRow{
				{kind: kindChannelRenamed, data: map[string]any{"old_name": "general", "new_name": "porch"}},
				{kind: kindTopicChanged, data: map[string]any{"topic": "Friday nights"}},
			}},
		{"all three", &chatv1.UpdateChannelRequest{Name: new("porch"), Topic: new("Friday nights"), PostPolicy: &admins},
			[]storedRow{
				{kind: kindChannelRenamed, data: map[string]any{"old_name": "general", "new_name": "porch"}},
				{kind: kindTopicChanged, data: map[string]any{"topic": "Friday nights"}},
				{kind: kindPostPolicyChanged, data: map[string]any{"post_policy": "admins"}},
			}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fixture := newSystemRows(t)
			if err := fixture.update(fixture.ada, tc.req); err != nil {
				t.Fatal(err)
			}
			adaID := authctx.UserID(fixture.ada)
			for index := range tc.want {
				tc.want[index].authorID = adaID
			}
			if got := fixture.systemRowsIn(fixture.channel.ID); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("rows = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// Clearing a topic records a cleared topic; saving the same values again
// records nothing; switching announcements off records the open policy.
func TestUpdateChannelClearsAndRepeats(t *testing.T) {
	fixture := newSystemRows(t)
	admins := chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS
	everyone := chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_EVERYONE
	steps := []*chatv1.UpdateChannelRequest{
		{Topic: new("Friday nights"), PostPolicy: &admins},
		{Topic: new("Friday nights"), PostPolicy: &admins},
		{Topic: new("")},
		{Topic: new("")},
		{PostPolicy: &everyone},
	}
	for _, step := range steps {
		if err := fixture.update(fixture.ada, step); err != nil {
			t.Fatal(err)
		}
	}
	adaID := authctx.UserID(fixture.ada)
	want := []storedRow{
		{kindTopicChanged, adaID, map[string]any{"topic": "Friday nights"}},
		{kindPostPolicyChanged, adaID, map[string]any{"post_policy": "admins"}},
		{kindTopicChanged, adaID, map[string]any{"topic": ""}},
		{kindPostPolicyChanged, adaID, map[string]any{"post_policy": "everyone"}},
	}
	if got := fixture.systemRowsIn(fixture.channel.ID); !reflect.DeepEqual(got, want) {
		t.Errorf("rows = %+v, want %+v", got, want)
	}
}

// A refused update writes nothing, the topic beside it included.
func TestFailedUpdateRecordsNothing(t *testing.T) {
	fixture := newSystemRows(t)
	if _, err := fixture.svc.CreateChannel(fixture.ada, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: fixture.spaceID, Name: "taken", Kind: chatv1.ChannelKind_CHANNEL_KIND_TEXT,
	})); err != nil {
		t.Fatal(err)
	}
	err := fixture.update(fixture.ada, &chatv1.UpdateChannelRequest{Name: new("taken"), Topic: new("Friday nights")})
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("rename onto a taken name: %v, want already exists", err)
	}
	if got := fixture.systemRowsIn(fixture.channel.ID); len(got) != 0 {
		t.Errorf("rows after a refused update = %+v, want none", got)
	}
	if channel := fixture.channelRow(fixture.channel.ID); channel.Topic != "" || channel.Name != "general" {
		t.Errorf("channel after a refused update = %s / %q, want general and no topic", channel.Name, channel.Topic)
	}
}

// A change marks nothing unread for anyone, the person who made it
// included, and leaves the channel's last message where it was.
func TestChannelChangesMarkNothingUnread(t *testing.T) {
	fixture := newSystemRows(t)
	message := fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "hello"})
	readers := map[string]context.Context{"ada": fixture.ada, "bea": fixture.bea, "cat": fixture.cat}
	before := map[string]readerState{}
	for name, reader := range readers {
		before[name] = fixture.state(reader)
	}
	if before["cat"].unread != 1 || before["cat"].lastMessageID != message.Id {
		t.Fatalf("cat before = %+v, want one unread", before["cat"])
	}
	admins := chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS
	if err := fixture.update(fixture.ada, &chatv1.UpdateChannelRequest{
		Name: new("porch"), Topic: new("Friday nights"), PostPolicy: &admins,
	}); err != nil {
		t.Fatal(err)
	}
	for name, reader := range readers {
		if got := fixture.state(reader); got != before[name] {
			t.Errorf("%s after the change = %+v, want %+v as before", name, got, before[name])
		}
	}
}

// heard is what a subscription receives within a moment: the payload
// kinds in order, and the created messages.
func heard(t *testing.T, sub *events.Subscription) ([]string, []*chatv1.Message) {
	t.Helper()
	var kinds []string
	var created []*chatv1.Message
	for {
		select {
		case event := <-sub.Events():
			switch payload := event.Payload.(type) {
			case *realtimev1.ServerEvent_ChannelUpdated:
				kinds = append(kinds, "channel_updated")
			case *realtimev1.ServerEvent_MessageCreated:
				kinds = append(kinds, "message_created")
				created = append(created, payload.MessageCreated)
			default:
				kinds = append(kinds, "other")
			}
		case <-time.After(300 * time.Millisecond):
			return kinds, created
		}
	}
}

// The rows go out after the channel update, in seq order, with their
// event, and only to those who may read the channel.
func TestChannelChangesArePublished(t *testing.T) {
	fixture := newSystemRows(t)
	bus := fixture.svc.bus.(*events.InProcBus)
	if _, err := fixture.pool.Exec(context.Background(), "UPDATE channels SET private = true WHERE id = $1", fixture.channel.ID); err != nil {
		t.Fatal(err)
	}
	for _, member := range []context.Context{fixture.ada, fixture.bea} {
		if _, err := fixture.pool.Exec(context.Background(),
			"INSERT INTO channel_members (channel_id, space_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
			fixture.channel.ID, fixture.spaceID, authctx.UserID(member)); err != nil {
			t.Fatal(err)
		}
	}
	space := bus.Subscribe(events.SpaceTopic(fixture.spaceID))
	defer space.Close()
	bea := bus.Subscribe(events.UserTopic(authctx.UserID(fixture.bea)))
	defer bea.Close()
	cat := bus.Subscribe(events.UserTopic(authctx.UserID(fixture.cat)))
	defer cat.Close()

	if err := fixture.update(fixture.ada, &chatv1.UpdateChannelRequest{Name: new("porch"), Topic: new("Friday nights")}); err != nil {
		t.Fatal(err)
	}
	kinds, created := heard(t, bea)
	if want := []string{"channel_updated", "message_created", "message_created"}; !reflect.DeepEqual(kinds, want) {
		t.Fatalf("bea heard %v, want %v", kinds, want)
	}
	if created[0].Seq >= created[1].Seq {
		t.Errorf("rows published out of seq order: %d then %d", created[0].Seq, created[1].Seq)
	}
	renamed := created[0].Event.GetChannelRenamed()
	if renamed.GetOldName() != "general" || renamed.GetNewName() != "porch" || created[0].Author.GetUsername() != "ada" || !created[0].Quiet {
		t.Errorf("first row = %v, want ada renaming general to porch, quiet", created[0])
	}
	if created[1].Event.GetTopicChanged().GetTopic() != "Friday nights" {
		t.Errorf("second row = %v, want the topic", created[1])
	}
	for name, sub := range map[string]*events.Subscription{"cat": cat, "the space": space} {
		if got, _ := heard(t, sub); len(got) != 0 {
			t.Errorf("%s, outside the private channel, heard %v", name, got)
		}
	}
}
