package chat

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

// Reminders (docs/architecture/messaging.md → Reminders): setting one,
// taking it back and what the request refuses. Delivery is in
// reminder_delivery_internal_test.go.

// remind sets a reminder that far ahead, in the fixture's channel unless
// channelID names another.
func (f *systemRows) remind(setter context.Context, channelID, text string, ahead time.Duration) *chatv1.CreateReminderResponse {
	f.t.Helper()
	if channelID == "" {
		channelID = f.channel.ID
	}
	res, err := f.svc.CreateReminder(setter, connect.NewRequest(remindRequest(channelID, text, ahead)))
	if err != nil {
		f.t.Fatal(err)
	}
	return res.Msg
}

// remindRequest asks for a reminder at the first whole minute at least
// that far ahead, as a date and time on UTC's clock.
func remindRequest(channelID, text string, ahead time.Duration) *chatv1.CreateReminderRequest {
	at := time.Now().Add(ahead).UTC().Truncate(time.Minute).Add(time.Minute)
	return &chatv1.CreateReminderRequest{
		ChannelId: channelID, Text: text, LocalTime: at.Format("2006-01-02T15:04"), TimeZone: "UTC",
	}
}

// waiting is how many reminders wait, everyone's.
func (f *systemRows) waiting() int {
	f.t.Helper()
	var count int
	if err := f.pool.QueryRow(context.Background(), `SELECT count(*) FROM reminders`).Scan(&count); err != nil {
		f.t.Fatal(err)
	}
	return count
}

func (f *systemRows) unremind(caller context.Context, id string) error {
	_, err := f.svc.DeleteReminder(caller, connect.NewRequest(&chatv1.DeleteReminderRequest{Id: id}))
	return err
}

// Setting a reminder stores one row, the time rounded down to the whole
// minute, and tells nobody: nothing is posted, published or marked.
func TestCreateReminderStoresItPrivately(t *testing.T) {
	fixture := newSystemRows(t)
	space := fixture.svc.bus.(*events.InProcBus).Subscribe(events.SpaceTopic(fixture.spaceID))
	defer space.Close()
	before := fixture.state(fixture.bea)

	// The server's clock decides: twenty minutes from when it heard.
	heard := time.Now()
	res, err := fixture.svc.CreateReminder(fixture.ada, connect.NewRequest(&chatv1.CreateReminderRequest{
		ChannelId: fixture.channel.ID, Text: "  Order the pizza  ",
		Preset: chatv1.ReminderPreset_REMINDER_PRESET_IN_20_MINUTES,
	}))
	if err != nil {
		t.Fatal(err)
	}
	want := res.Msg.RemindAt.AsTime()
	earliest, latest := heard.Add(20*time.Minute).Truncate(time.Minute), time.Now().Add(20*time.Minute)
	if want.Before(earliest) || want.After(latest) || !want.Equal(want.Truncate(time.Minute)) {
		t.Errorf("answered remind_at = %s, want a whole minute from %s to %s", want, earliest, latest)
	}
	var stored dbgen.Reminder
	if err := fixture.pool.QueryRow(context.Background(),
		`SELECT id, channel_id, user_id, content, remind_at FROM reminders`).
		Scan(&stored.ID, &stored.ChannelID, &stored.UserID, &stored.Content, &stored.RemindAt); err != nil {
		t.Fatal(err)
	}
	if stored.ID != res.Msg.Id || stored.ChannelID != fixture.channel.ID || stored.UserID != authctx.UserID(fixture.ada) ||
		stored.Content != "Order the pizza" || !stored.RemindAt.Equal(want) {
		t.Errorf("stored = %+v, want ada's trimmed reminder at %s", stored, want)
	}
	if got := everyEvent(space); len(got) != 0 {
		t.Errorf("setting a reminder published %v", got)
	}
	if got := fixture.state(fixture.bea); got != before {
		t.Errorf("bea's state = %+v, want it as it was: %+v", got, before)
	}
	if rows := fixture.listed(fixture.bea); len(rows) != 0 {
		t.Errorf("the channel holds %d rows, want none", len(rows))
	}
}

// The text is one line of 1 to 200 characters under a poll question's
// rules, and a refused time stores nothing (the times themselves are in
// reminder_time_internal_test.go).
func TestCreateReminderValidation(t *testing.T) {
	fixture := newSystemRows(t)
	in := func(text string) *chatv1.CreateReminderRequest {
		return &chatv1.CreateReminderRequest{Text: text, Preset: chatv1.ReminderPreset_REMINDER_PRESET_IN_1_HOUR}
	}
	at := func(local, zone string) *chatv1.CreateReminderRequest {
		return &chatv1.CreateReminderRequest{Text: "Order the pizza", LocalTime: local, TimeZone: zone}
	}
	for name, tc := range map[string]struct {
		req  *chatv1.CreateReminderRequest
		want string
	}{
		"no text":              {in("   "), "needs some text"},
		"too long":             {in(strings.Repeat("a", 201)), "at most 200 characters"},
		"a line break":         {in("one\ntwo"), "line break"},
		"a tab":                {in("one\ttwo"), "control character"},
		"a direction override": {in("one\u202etwo"), "text direction override"},
		"nothing visible":      {in("\u200b\u200b"), "visible character"},
		"no time":              {&chatv1.CreateReminderRequest{Text: "Order the pizza"}, "needs a time"},
		"in the past":          {at("2020-01-01T09:00", "UTC"), "at least a minute"},
		"too far":              {at("2099-01-01T09:00", "UTC"), "at most a year"},
		"no zone":              {at("2099-01-01T09:00", ""), "needs a time zone"},
		"an unknown zone":      {at("2099-01-01T09:00", "Mars/Olympus"), "not one the server knows"},
	} {
		tc.req.ChannelId = fixture.channel.ID
		_, err := fixture.svc.CreateReminder(fixture.ada, connect.NewRequest(tc.req))
		if connect.CodeOf(err) != connect.CodeInvalidArgument || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: err = %v, want InvalidArgument naming %q", name, err, tc.want)
		}
	}
	if got := fixture.waiting(); got != 0 {
		t.Fatalf("%d reminders stored by refused requests", got)
	}

	// At the limits: 200 characters, counted in characters and not bytes,
	// a little over a minute and a little under a year.
	fixture.remind(fixture.ada, "", strings.Repeat("é", 200), 65*time.Second)
	fixture.remind(fixture.ada, "", "Renew the domain", 364*24*time.Hour)
	if got := fixture.waiting(); got != 2 {
		t.Errorf("%d reminders stored at the limits, want 2", got)
	}
}

// Whoever may send a message may set a reminder, and nobody else: a
// member of an announcement channel, someone outside the space and
// someone outside a private channel are refused as their message would
// be, and a refusal for the text comes before any of it.
func TestCreateReminderNeedsToBeAbleToPost(t *testing.T) {
	fixture := newSystemRows(t)
	hidden := fixture.privateChannel("back-room", authctx.UserID(fixture.bea))
	policy := chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS
	if _, err := fixture.svc.UpdateChannel(fixture.ada, connect.NewRequest(&chatv1.UpdateChannelRequest{
		ChannelId: fixture.channel.ID, PostPolicy: &policy,
	})); err != nil {
		t.Fatal(err)
	}
	create := func(setter context.Context, channelID, text string) error {
		_, err := fixture.svc.CreateReminder(setter, connect.NewRequest(remindRequest(channelID, text, time.Hour)))
		return err
	}
	if err := create(fixture.cat, fixture.channel.ID, "Friday"); connect.CodeOf(err) != connect.CodePermissionDenied || !strings.Contains(err.Error(), "announcement channel") {
		t.Errorf("a member in an announcement channel: err = %v, want the announcement refusal", err)
	}
	outsider := authctx.WithIdentity(context.Background(), authctx.Identity{
		UserID: newOutsider(t, fixture), Role: authctx.RoleMember,
	})
	if err := create(outsider, fixture.channel.ID, "Friday"); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("someone outside the space: err = %v, want PermissionDenied", err)
	}
	if err := create(fixture.cat, hidden, "Friday"); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("someone outside a private channel: err = %v, want NotFound", err)
	}
	if err := create(fixture.cat, hidden, ""); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("no text, in a channel the caller cannot see: err = %v, want InvalidArgument first", err)
	}
	// A token whose bounds do not reach the channel.
	bounded := authctx.WithIdentity(context.Background(), authctx.Identity{
		UserID: authctx.UserID(fixture.ada), Role: authctx.RoleMember,
		Credential: authctx.Credential{
			Kind: authctx.CredentialPersonalToken, Grants: []authctx.Action{authctx.MessagesPost},
			Bounded: true, Channels: []string{hidden},
		},
	})
	if err := create(bounded, fixture.channel.ID, "Friday"); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a token bounded elsewhere: err = %v, want PermissionDenied", err)
	}
	if got := fixture.waiting(); got != 0 {
		t.Fatalf("%d reminders stored by refused requests", got)
	}
	if err := create(fixture.ada, fixture.channel.ID, "Friday"); err != nil {
		t.Errorf("the owner in an announcement channel: %v", err)
	}
	if err := create(fixture.bea, hidden, "Friday"); err != nil {
		t.Errorf("a member of the private channel: %v", err)
	}
	if err := create(bounded, hidden, "Friday"); err != nil {
		t.Errorf("a token bounded to the channel: %v", err)
	}
}

// A person has at most 50 reminders waiting, across every channel; the
// count is theirs alone, and one taken back or delivered makes room.
func TestReminderCap(t *testing.T) {
	fixture := newSystemRows(t)
	adaID := authctx.UserID(fixture.ada)
	if _, err := fixture.pool.Exec(context.Background(),
		`INSERT INTO reminders (id, channel_id, user_id, content, remind_at)
		 SELECT gen_random_uuid(), $1, $2, 'waiting', now() + interval '1 day' FROM generate_series(1, $3)`,
		fixture.channel.ID, adaID, maxWaitingReminders-1); err != nil {
		t.Fatal(err)
	}
	last := fixture.remind(fixture.ada, "", "the fiftieth", time.Hour)
	create := func(setter context.Context) error {
		_, err := fixture.svc.CreateReminder(setter, connect.NewRequest(remindRequest(fixture.channel.ID, "one more", time.Hour)))
		return err
	}
	if err := create(fixture.ada); connect.CodeOf(err) != connect.CodeResourceExhausted || !strings.Contains(err.Error(), "at most 50") {
		t.Errorf("the 51st: err = %v, want ResourceExhausted naming the limit", err)
	}
	if err := create(fixture.bea); err != nil {
		t.Errorf("someone else, with ada at her limit: %v", err)
	}
	if err := fixture.unremind(fixture.ada, last.Id); err != nil {
		t.Fatal(err)
	}

	// One place left and eight requests at once: one takes it.
	var wg sync.WaitGroup
	results := make(chan error, 8)
	for range 8 {
		wg.Go(func() { results <- create(fixture.ada) })
	}
	wg.Wait()
	close(results)
	stored := 0
	for err := range results {
		switch {
		case err == nil:
			stored++
		case connect.CodeOf(err) != connect.CodeResourceExhausted:
			t.Errorf("a request racing for the last place: %v", err)
		}
	}
	var held int
	if err := fixture.pool.QueryRow(context.Background(), `SELECT count(*) FROM reminders WHERE user_id = $1`, adaID).Scan(&held); err != nil {
		t.Fatal(err)
	}
	if stored != 1 || held != maxWaitingReminders {
		t.Errorf("%d of the racing requests were stored and ada holds %d, want 1 and %d", stored, held, maxWaitingReminders)
	}
}

// Undo takes back only the caller's own waiting reminder. Someone
// else's, an id that names none, one a bounded token does not reach and
// one already posted are all not found, and the first three stay.
func TestDeleteReminder(t *testing.T) {
	fixture := newSystemRows(t)
	mine := fixture.remind(fixture.ada, "", "Order the pizza", time.Hour)
	theirs := fixture.remind(fixture.bea, "", "Bring the dice", time.Hour)

	for name, id := range map[string]string{
		"someone else's":   theirs.Id,
		"no such reminder": "00000000-0000-7000-8000-000000000001",
		"not an id":        "pizza",
		"empty":            "",
	} {
		if err := fixture.unremind(fixture.ada, id); connect.CodeOf(err) != connect.CodeNotFound {
			t.Errorf("%s: err = %v, want NotFound", name, err)
		}
	}
	elsewhere := authctx.WithIdentity(context.Background(), authctx.Identity{
		UserID: authctx.UserID(fixture.ada), Role: authctx.RoleMember,
		Credential: authctx.Credential{
			Kind: authctx.CredentialPersonalToken, Grants: []authctx.Action{authctx.MessagesPost},
			Bounded: true, Channels: []string{"00000000-0000-7000-8000-000000000002"},
		},
	})
	if err := fixture.unremind(elsewhere, mine.Id); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("a token bounded elsewhere: err = %v, want NotFound", err)
	}
	if got := fixture.waiting(); got != 2 {
		t.Fatalf("%d reminders wait after the refusals, want both", got)
	}

	if err := fixture.unremind(fixture.ada, mine.Id); err != nil {
		t.Fatal(err)
	}
	if err := fixture.unremind(fixture.ada, mine.Id); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("a second Undo: err = %v, want NotFound", err)
	}
	// Bea's has been posted: there is nothing left to take back.
	if report := fixture.deliver(time.Now().Add(2 * time.Hour)); report.Delivered != 1 {
		t.Fatalf("delivery = %+v, want bea's delivered", report)
	}
	if err := fixture.unremind(fixture.bea, theirs.Id); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("Undo after it was posted: err = %v, want NotFound", err)
	}
	if got := fixture.reminderRows(fixture.channel.ID); len(got) != 1 || got[0].content != "Bring the dice" {
		t.Errorf("posted reminders = %+v, want bea's alone", got)
	}
}

// Someone who has left the channel still takes their reminder back.
func TestDeleteReminderAfterLeaving(t *testing.T) {
	fixture := newSystemRows(t)
	reminder := fixture.remind(fixture.cat, "", "Order the pizza", time.Hour)
	if _, err := fixture.svc.LeaveSpace(fixture.cat, connect.NewRequest(&chatv1.LeaveSpaceRequest{SpaceId: fixture.spaceID})); err != nil {
		t.Fatal(err)
	}
	if err := fixture.unremind(fixture.cat, reminder.Id); err != nil {
		t.Errorf("Undo after leaving the space: %v", err)
	}
	if got := fixture.waiting(); got != 0 {
		t.Errorf("%d reminders wait, want none", got)
	}
}

// The registry's flags for a reminder: it marks unread, is its author's
// to delete and cannot be pinned. Its text is kept out of data.
func TestReminderKind(t *testing.T) {
	registered := systemKinds[kindReminder]
	if registered.quiet || registered.pinnable || !registered.authorDeletes {
		t.Errorf("kind 9: quiet %v pinnable %v authorDeletes %v, want false false true",
			registered.quiet, registered.pinnable, registered.authorDeletes)
	}
	if !typedAsIs(kindReminder) {
		t.Error("a reminder's text is not read as typed")
	}
	if got := previewOf(kindReminder, "*Friday*", "notes.txt"); got != "Reminder: *Friday*" {
		t.Errorf("preview = %q", got)
	}
	if err := (reminderFired{}).check(); err == nil {
		t.Error("a reminder with no text may be recorded")
	}
	event, err := registered.decode([]byte(`{}`))
	if err != nil || !proto.Equal(event.proto(nil), &chatv1.SystemEvent{Kind: &chatv1.SystemEvent_Reminder{Reminder: &chatv1.Reminder{}}}) {
		t.Errorf("a stored reminder reads back as %v, %v", event, err)
	}
}

// failingUsers is a directory that cannot be reached.
type failingUsers struct{}

func (failingUsers) GetUsers(context.Context, []string) ([]UserRecord, error) {
	return nil, errors.New("the directory is away")
}

// deliver runs one delivery as of at, and fails the test if it does.
func (f *systemRows) deliver(at time.Time) ReminderReport {
	f.t.Helper()
	report, err := f.svc.DeliverReminders(context.Background(), at)
	if err != nil {
		f.t.Fatal(err)
	}
	return report
}

type postedReminder struct{ id, authorID, content, data string }

// reminderRows are a channel's live reminder rows, oldest first.
func (f *systemRows) reminderRows(channelID string) []postedReminder {
	f.t.Helper()
	rows, err := f.pool.Query(context.Background(),
		`SELECT id, author_id, content, data::text FROM messages
		 WHERE channel_id = $1 AND kind = $2 AND deleted_at IS NULL ORDER BY seq`, channelID, kindReminder)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rows.Close()
	var out []postedReminder
	for rows.Next() {
		var row postedReminder
		if err := rows.Scan(&row.id, &row.authorID, &row.content, &row.data); err != nil {
			f.t.Fatal(err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		f.t.Fatal(err)
	}
	return out
}

// textChannel is another public text channel in the fixture's space.
func (f *systemRows) textChannel(name string) string {
	f.t.Helper()
	created, err := f.svc.CreateChannel(f.ada, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: f.spaceID, Name: name, Kind: chatv1.ChannelKind_CHANNEL_KIND_TEXT,
	}))
	if err != nil {
		f.t.Fatal(err)
	}
	return created.Msg.Channel.Id
}

func describe(report ReminderReport) string {
	return fmt.Sprintf("%d delivered, %d dropped, %d failed", report.Delivered, report.Dropped, report.Failed)
}
