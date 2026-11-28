package chat

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/events"
)

// Delivering reminders (docs/architecture/messaging.md → Reminders):
// what a delivered one is, who hears of it, when one is dropped or kept,
// and delivery against an Undo, a channel delete and another dispatcher.

// later is a moment by which every reminder these tests set is due.
func later() time.Time { return time.Now().Add(48 * time.Hour) }

// A reminder is not posted before its time. At its time it is one row by
// the person who set it: kind 9, the text in content and nothing in
// data, not quiet. It is published as it is listed, becomes the
// channel's last message and is unread for everyone, the person who set
// it included: nobody's read marker moves. Nobody is alerted, and the
// waiting row is gone.
func TestReminderIsDeliveredInAChannel(t *testing.T) {
	fixture := newSystemRows(t)
	fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "hello"})
	for _, reader := range []context.Context{fixture.ada, fixture.bea} {
		fixture.markRead(reader, fixture.channel.ID)
	}
	text := typedQuestion(fixture.bea)
	reminder := fixture.remind(fixture.ada, "", text, 20*time.Minute)
	space := fixture.svc.bus.(*events.InProcBus).Subscribe(events.SpaceTopic(fixture.spaceID))
	defer space.Close()

	early := reminder.RemindAt.AsTime().Add(-time.Second)
	if report := fixture.deliver(early); report != (ReminderReport{}) || fixture.waiting() != 1 {
		t.Fatalf("a second before its time: %s, %d waiting; want nothing done", describe(report), fixture.waiting())
	}
	if report := fixture.deliver(reminder.RemindAt.AsTime()); report != (ReminderReport{Delivered: 1}) {
		t.Fatalf("at its time: %s, want one delivered", describe(report))
	}
	if got := fixture.waiting(); got != 0 {
		t.Errorf("%d reminders wait after delivery, want none", got)
	}
	rows := fixture.reminderRows(fixture.channel.ID)
	if len(rows) != 1 || rows[0].authorID != authctx.UserID(fixture.ada) || rows[0].content != text || rows[0].data != "{}" {
		t.Fatalf("rows = %+v, want one by ada holding the text as typed and no data", rows)
	}

	listed := fixture.listed(fixture.bea)
	posted := listed[len(listed)-1]
	want := &chatv1.SystemEvent{Kind: &chatv1.SystemEvent_Reminder{Reminder: &chatv1.Reminder{}}}
	if posted.Id != rows[0].id || !proto.Equal(posted.Event, want) || posted.Content != text || posted.Quiet ||
		posted.Author.GetId() != authctx.UserID(fixture.ada) || len(posted.MentionUserIds) != 0 {
		t.Errorf("listed row = %v, want ada's reminder: not quiet, nobody mentioned", posted)
	}
	heard := everyEvent(space)
	if len(heard) != 1 || !proto.Equal(heard[0].GetMessageCreated(), posted) {
		t.Errorf("the space heard %v, want one message_created of the row as listed", heard)
	}
	for name, reader := range map[string]context.Context{"the person who set it": fixture.ada, "someone else": fixture.bea} {
		state := fixture.state(reader)
		if state.unread != 1 || state.lastMessageID != posted.Id || !state.spaceHasUnread || state.channelAlerts != 0 || state.spaceAlerts != 0 {
			t.Errorf("%s: state = %+v, want one unread, the reminder last, no alerts", name, state)
		}
		if items := fixture.activity(reader); len(items) != 0 {
			t.Errorf("%s has activity for a reminder in a channel: %v", name, items)
		}
	}
	// A second run finds nothing to do.
	if report := fixture.deliver(later()); report != (ReminderReport{}) || len(fixture.reminderRows(fixture.channel.ID)) != 1 {
		t.Errorf("a second run: %s, want nothing done", describe(report))
	}
}

// In someone's own notes, a direct message and a group conversation a
// delivered reminder puts a closed conversation back on the others'
// lists, is everyone's unread last message and alerts each person in it
// once, the one who set it included, previewed "Reminder: " and its
// text exactly as typed.
func TestReminderIsDeliveredInAConversation(t *testing.T) {
	for name, size := range map[string]int{"own notes": 0, "direct message": 1, "group conversation": 2} {
		t.Run(name, func(t *testing.T) {
			fixture := newSystemRows(t)
			others := []context.Context{fixture.bea, fixture.cat}[:size]
			conversation := fixture.conversation(fixture.ada, others...)
			text := typedQuestion(fixture.bea)
			want := "Reminder: " + text
			fixture.remind(fixture.ada, conversation.ID, text, time.Hour)
			for _, other := range others {
				if _, err := fixture.svc.SetDirectMessageClosed(other, connect.NewRequest(&chatv1.SetDirectMessageClosedRequest{
					ChannelId: conversation.ID, Closed: true,
				})); err != nil {
					t.Fatal(err)
				}
			}
			bea := fixture.svc.bus.(*events.InProcBus).Subscribe(events.UserTopic(authctx.UserID(fixture.bea)))
			defer bea.Close()
			ada := fixture.svc.bus.(*events.InProcBus).Subscribe(events.UserTopic(authctx.UserID(fixture.ada)))
			defer ada.Close()

			if report := fixture.deliver(later()); report != (ReminderReport{Delivered: 1}) {
				t.Fatalf("delivery: %s, want one delivered", describe(report))
			}
			rows := fixture.reminderRows(conversation.ID)
			if len(rows) != 1 || rows[0].content != text {
				t.Fatalf("rows = %+v, want the reminder as typed", rows)
			}
			for _, other := range others {
				listed := fixture.listedConversation(other, conversation.ID)
				if listed.Closed || listed.Channel.UnreadCount != 1 || listed.LastMessage.GetMessageId() != rows[0].id ||
					listed.LastMessage.GetPreview() != want || listed.LastMessage.GetAuthor().GetId() != authctx.UserID(fixture.ada) {
					t.Errorf("the conversation for someone else = %v, want it reopened, one unread, last message %q", listed, want)
				}
				items := fixture.activity(other)
				if len(items) != 1 || items[0].Kind != chatv1.ActivityKind_ACTIVITY_KIND_DM || items[0].MessageId != rows[0].id ||
					items[0].ChannelId != conversation.ID || items[0].Preview != want || items[0].ReadAt != nil ||
					items[0].Actor.GetId() != authctx.UserID(fixture.ada) {
					t.Fatalf("activity for someone else = %v, want one unread dm item by ada previewed %q", items, want)
				}
				// What push reads before it sends.
				pending, err := fixture.svc.PendingActivity(context.Background(), authctx.UserID(other), items[0].Id)
				if err != nil || pending.GetPreview() != want {
					t.Errorf("pending activity = %v, %v; want it previewed %q", pending, err, want)
				}
			}
			// The person who set it is alerted as everyone is, and in their
			// own notes is the only one.
			mine := fixture.activity(fixture.ada)
			if len(mine) != 1 || mine[0].Kind != chatv1.ActivityKind_ACTIVITY_KIND_DM || mine[0].MessageId != rows[0].id ||
				mine[0].ChannelId != conversation.ID || mine[0].Preview != want || mine[0].ReadAt != nil {
				t.Fatalf("activity for the person who set it = %v, want one unread dm item previewed %q", mine, want)
			}
			if pending, err := fixture.svc.PendingActivity(context.Background(), authctx.UserID(fixture.ada), mine[0].Id); err != nil || pending.GetPreview() != want {
				t.Errorf("their pending activity = %v, %v; want it previewed %q", pending, err, want)
			}
			if listed := fixture.listedConversation(fixture.ada, conversation.ID); listed.Channel.UnreadCount != 1 || listed.LastMessage.GetMessageId() != rows[0].id {
				t.Errorf("the conversation for the person who set it = %v, want one unread and the reminder last", listed)
			}

			var reopened, created, alerted int
			for _, event := range everyEvent(bea) {
				switch {
				case event.GetChannelCreated().GetId() == conversation.ID:
					reopened++
				case event.GetMessageCreated().GetId() == rows[0].id:
					created++
				case event.GetActivityItemCreated().GetItem().GetPreview() == want:
					alerted++
				}
			}
			if size > 0 && (reopened != 1 || created != 1 || alerted != 1) {
				t.Errorf("bea heard %d reopen, %d reminder, %d alert previewed %q; want one of each", reopened, created, alerted, want)
			}
			if size == 0 && reopened+created+alerted != 0 {
				t.Errorf("bea heard of a reminder in ada's own notes")
			}
			var own int
			for _, event := range everyEvent(ada) {
				if event.GetActivityItemCreated().GetItem().GetPreview() == want {
					own++
				}
			}
			if own != 1 {
				t.Errorf("the person who set it heard %d alerts, want one", own)
			}
		})
	}
}

// A delivered reminder is its author's to delete, and a moderator's; in
// a conversation its author's alone. It is found by its text, and takes
// nothing a person's message takes: no pin, reaction, reply or edit.
func TestDeliveredReminderRow(t *testing.T) {
	fixture := newSystemRows(t)
	conversation := fixture.conversation(fixture.bea, fixture.cat)
	fixture.remind(fixture.bea, "", "Order the pizza", time.Hour)
	fixture.remind(fixture.cat, "", "Bring the dice", time.Hour)
	fixture.remind(fixture.bea, conversation.ID, "Call the landlord", time.Hour)
	if report := fixture.deliver(later()); report != (ReminderReport{Delivered: 3}) {
		t.Fatalf("delivery: %s, want three delivered", describe(report))
	}
	inChannel := fixture.reminderRows(fixture.channel.ID)
	pizza, dice := inChannel[0], inChannel[1]
	landlord := fixture.reminderRows(conversation.ID)[0]

	found, err := fixture.svc.SearchMessages(fixture.ada, connect.NewRequest(&chatv1.SearchMessagesRequest{
		Scope: &chatv1.SearchMessagesRequest_SpaceId{SpaceId: fixture.spaceID}, Query: "pizza",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if got := messageIDs(found.Msg.Messages); fmt.Sprint(got) != fmt.Sprint([]string{pizza.id}) {
		t.Errorf("search for its text = %v, want the reminder %s", got, pizza.id)
	}

	refused := map[string]error{}
	_, refused["a pin"] = fixture.svc.SetMessagePinned(fixture.ada, connect.NewRequest(&chatv1.SetMessagePinnedRequest{MessageId: pizza.id, Pinned: true}))
	_, refused["a reaction"] = fixture.svc.ToggleReaction(fixture.bea, connect.NewRequest(&chatv1.ToggleReactionRequest{MessageId: pizza.id, Emoji: "👍"}))
	_, refused["an edit"] = fixture.svc.EditMessage(fixture.bea, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: pizza.id, Content: "Order two"}))
	_, refused["a reply"] = fixture.svc.SendMessage(fixture.cat, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: fixture.channel.ID, Content: "on it", ReplyToMessageId: pizza.id,
	}))
	_, refused["a thread"] = fixture.svc.SendMessage(fixture.cat, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: fixture.channel.ID, Content: "on it", ThreadRootId: pizza.id,
	}))
	for what, err := range refused {
		if connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Errorf("%s on a reminder: err = %v, want FailedPrecondition", what, err)
		}
	}

	remove := func(caller context.Context, messageID string) error {
		_, err := fixture.svc.DeleteMessage(caller, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: messageID}))
		return err
	}
	if err := remove(fixture.cat, pizza.id); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("another member deleting it: err = %v, want PermissionDenied", err)
	}
	if err := remove(fixture.bea, pizza.id); err != nil {
		t.Errorf("its author deleting it: %v", err)
	}
	if err := remove(fixture.ada, dice.id); err != nil {
		t.Errorf("the owner deleting someone's reminder: %v", err)
	}
	if err := remove(fixture.cat, landlord.id); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("the other participant deleting it: err = %v, want PermissionDenied", err)
	}
	if err := remove(fixture.bea, landlord.id); err != nil {
		t.Errorf("its author deleting it in a conversation: %v", err)
	}
	if left := len(fixture.reminderRows(fixture.channel.ID)) + len(fixture.reminderRows(conversation.ID)); left != 0 {
		t.Errorf("%d reminders left live, want none", left)
	}
	if state := fixture.state(fixture.ada); state.lastMessageID != "" {
		t.Errorf("the channel's last message = %s, want none once both are deleted", state.lastMessageID)
	}
}

// voiceSwitch is an instance whose voice can be turned off.
type voiceSwitch struct{ on bool }

func (*voiceSwitch) MembersMayCreateSpaces(context.Context) (bool, error) { return true, nil }
func (*voiceSwitch) MessageRetentionDays(context.Context) (int, error)    { return 0, nil }
func (policy *voiceSwitch) VoiceAvailable() bool                          { return policy.on }

// A reminder is dropped, posted nowhere and told to nobody, when the
// person who set it may no longer post in its channel at its time.
func TestReminderIsDroppedWhenItsPersonMayNotPost(t *testing.T) {
	sql := func(fixture *systemRows, statement string, args ...any) {
		fixture.t.Helper()
		if _, err := fixture.pool.Exec(context.Background(), statement, args...); err != nil {
			fixture.t.Fatal(err)
		}
	}
	// Each case sets cat's reminder and then takes away cat's standing;
	// it returns the channel the reminder was for.
	cases := map[string]func(fixture *systemRows) string{
		"left the space": func(fixture *systemRows) string {
			fixture.remind(fixture.cat, "", "Friday", time.Hour)
			if _, err := fixture.svc.LeaveSpace(fixture.cat, connect.NewRequest(&chatv1.LeaveSpaceRequest{SpaceId: fixture.spaceID})); err != nil {
				fixture.t.Fatal(err)
			}
			return fixture.channel.ID
		},
		"kicked from the space": func(fixture *systemRows) string {
			fixture.remind(fixture.cat, "", "Friday", time.Hour)
			if _, err := fixture.svc.KickMember(fixture.ada, connect.NewRequest(&chatv1.KickMemberRequest{
				SpaceId: fixture.spaceID, UserId: authctx.UserID(fixture.cat),
			})); err != nil {
				fixture.t.Fatal(err)
			}
			return fixture.channel.ID
		},
		"removed from a private channel": func(fixture *systemRows) string {
			room := fixture.privateChannel("back-room", authctx.UserID(fixture.cat))
			fixture.remind(fixture.cat, room, "Friday", time.Hour)
			if _, err := fixture.svc.RemoveChannelMember(fixture.ada, connect.NewRequest(&chatv1.RemoveChannelMemberRequest{
				ChannelId: room, UserId: authctx.UserID(fixture.cat),
			})); err != nil {
				fixture.t.Fatal(err)
			}
			return room
		},
		"the channel became announcement-only": func(fixture *systemRows) string {
			fixture.remind(fixture.cat, "", "Friday", time.Hour)
			policy := chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS
			if _, err := fixture.svc.UpdateChannel(fixture.ada, connect.NewRequest(&chatv1.UpdateChannelRequest{
				ChannelId: fixture.channel.ID, PostPolicy: &policy,
			})); err != nil {
				fixture.t.Fatal(err)
			}
			return fixture.channel.ID
		},
		"blocked in a direct message": func(fixture *systemRows) string {
			conversation := fixture.conversation(fixture.cat, fixture.bea)
			fixture.remind(fixture.cat, conversation.ID, "Friday", time.Hour)
			if _, err := fixture.svc.BlockUser(fixture.bea, connect.NewRequest(&chatv1.BlockUserRequest{UserId: authctx.UserID(fixture.cat)})); err != nil {
				fixture.t.Fatal(err)
			}
			return conversation.ID
		},
		// A deleted person stays a participant of their conversations
		// (and is deactivated with it: users_deleted_is_deactivated).
		"account deleted": func(fixture *systemRows) string {
			conversation := fixture.conversation(fixture.cat, fixture.bea)
			fixture.remind(fixture.cat, conversation.ID, "Friday", time.Hour)
			sql(fixture, `UPDATE users SET deleted_at = now(), deactivated_at = now() WHERE id = $1`, authctx.UserID(fixture.cat))
			return conversation.ID
		},
		// A deactivated person is still a member of the space.
		"account deactivated": func(fixture *systemRows) string {
			fixture.remind(fixture.cat, "", "Friday", time.Hour)
			sql(fixture, `UPDATE users SET deactivated_at = now() WHERE id = $1`, authctx.UserID(fixture.cat))
			return fixture.channel.ID
		},
		"voice turned off, in a voice channel's chat": func(fixture *systemRows) string {
			policy := &voiceSwitch{on: true}
			fixture.svc.UseInstancePolicy(policy)
			created, err := fixture.svc.CreateChannel(fixture.ada, connect.NewRequest(&chatv1.CreateChannelRequest{
				SpaceId: fixture.spaceID, Name: "hangout", Kind: chatv1.ChannelKind_CHANNEL_KIND_VOICE,
			}))
			if err != nil {
				fixture.t.Fatal(err)
			}
			fixture.remind(fixture.cat, created.Msg.Channel.Id, "Friday", time.Hour)
			policy.on = false
			return created.Msg.Channel.Id
		},
	}
	for name, lose := range cases {
		t.Run(name, func(t *testing.T) {
			fixture := newSystemRows(t)
			channelID := lose(fixture)
			bea := fixture.svc.bus.(*events.InProcBus).Subscribe(events.UserTopic(authctx.UserID(fixture.bea)))
			defer bea.Close()
			space := fixture.svc.bus.(*events.InProcBus).Subscribe(events.SpaceTopic(fixture.spaceID))
			defer space.Close()

			if report := fixture.deliver(later()); report != (ReminderReport{Dropped: 1}) {
				t.Errorf("delivery: %s, want one dropped", describe(report))
			}
			if rows, waiting := fixture.reminderRows(channelID), fixture.waiting(); len(rows) != 0 || waiting != 0 {
				t.Errorf("%d rows posted and %d reminders waiting, want neither", len(rows), waiting)
			}
			if heard := append(everyEvent(bea), everyEvent(space)...); len(heard) != 0 {
				t.Errorf("a dropped reminder published %v", heard)
			}
			if items := fixture.activity(fixture.bea); len(items) != 0 {
				t.Errorf("a dropped reminder alerted bea: %v", items)
			}
		})
	}
}

// What drops one person's reminder leaves another's alone: in an
// announcement channel the owner's is posted and a member's is not.
func TestReminderOfSomeoneWhoMayStillPostIsDelivered(t *testing.T) {
	fixture := newSystemRows(t)
	fixture.remind(fixture.cat, "", "from a member", time.Hour)
	fixture.remind(fixture.ada, "", "from the owner", time.Hour)
	policy := chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS
	if _, err := fixture.svc.UpdateChannel(fixture.ada, connect.NewRequest(&chatv1.UpdateChannelRequest{
		ChannelId: fixture.channel.ID, PostPolicy: &policy,
	})); err != nil {
		t.Fatal(err)
	}
	if report := fixture.deliver(later()); report != (ReminderReport{Delivered: 1, Dropped: 1}) {
		t.Errorf("delivery: %s, want one delivered and one dropped", describe(report))
	}
	if rows := fixture.reminderRows(fixture.channel.ID); len(rows) != 1 || rows[0].content != "from the owner" {
		t.Errorf("rows = %+v, want the owner's alone", rows)
	}
}

// An error that may pass keeps the reminder: the run reports it, the row
// waits, and the next run delivers it.
func TestPassingErrorKeepsTheReminder(t *testing.T) {
	fixture := newSystemRows(t)
	fixture.remind(fixture.ada, "", "Order the pizza", time.Hour)
	directory := fixture.svc.users
	fixture.svc.users = failingUsers{}

	report, err := fixture.svc.DeliverReminders(context.Background(), later())
	if err == nil || report != (ReminderReport{Failed: 1}) {
		t.Fatalf("with the directory away: %s, err %v; want one failed and an error", describe(report), err)
	}
	if rows, waiting := fixture.reminderRows(fixture.channel.ID), fixture.waiting(); len(rows) != 0 || waiting != 1 {
		t.Fatalf("%d rows posted and %d reminders waiting, want it kept", len(rows), waiting)
	}

	fixture.svc.users = directory
	if report := fixture.deliver(later()); report != (ReminderReport{Delivered: 1}) {
		t.Errorf("the next run: %s, want it delivered", describe(report))
	}
	if rows := fixture.reminderRows(fixture.channel.ID); len(rows) != 1 {
		t.Errorf("%d rows posted, want one", len(rows))
	}
}

// holdReminderRows makes writing a reminder's row whose text is held
// wait until release, and one whose text is refused fail.
func (f *systemRows) holdReminderRows() (release func()) {
	f.t.Helper()
	ctx := context.Background()
	if _, err := f.pool.Exec(ctx, `
		CREATE FUNCTION test_reminder_row() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.kind = 9 AND NEW.content = 'refused' THEN RAISE EXCEPTION 'refused by the test'; END IF;
			IF NEW.kind = 9 AND NEW.content = 'held' THEN PERFORM pg_advisory_xact_lock(424242); END IF;
			RETURN NEW;
		END $$;
		CREATE TRIGGER test_reminder_row BEFORE INSERT ON messages
		FOR EACH ROW EXECUTE FUNCTION test_reminder_row()`); err != nil {
		f.t.Fatal(err)
	}
	tx, err := f.pool.Begin(ctx)
	if err != nil {
		f.t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(424242)`); err != nil {
		f.t.Fatal(err)
	}
	var once sync.Once
	release = func() { once.Do(func() { _ = tx.Rollback(ctx) }) }
	f.t.Cleanup(release)
	return release
}

// One reminder that cannot be posted does not stop the rest of the run:
// it is logged and kept, the others are delivered, and the run fails so
// that it shows.
func TestFailingReminderDoesNotStopTheRest(t *testing.T) {
	fixture := newSystemRows(t)
	fixture.holdReminderRows()
	fixture.remind(fixture.ada, "", "refused", time.Hour)
	fixture.remind(fixture.ada, "", "Order the pizza", 2*time.Hour)
	fixture.remind(fixture.bea, "", "Bring the dice", 3*time.Hour)

	report, err := fixture.svc.DeliverReminders(context.Background(), later())
	if err == nil || report != (ReminderReport{Delivered: 2, Failed: 1}) {
		t.Fatalf("delivery: %s, err %v; want two delivered, one failed and an error", describe(report), err)
	}
	rows := fixture.reminderRows(fixture.channel.ID)
	if len(rows) != 2 || rows[0].content != "Order the pizza" || rows[1].content != "Bring the dice" {
		t.Errorf("rows = %+v, want the two that could be posted, oldest first", rows)
	}
	var kept string
	if err := fixture.pool.QueryRow(context.Background(), `SELECT content FROM reminders`).Scan(&kept); err != nil || kept != "refused" {
		t.Errorf("the reminder kept = %q, %v; want the one that failed", kept, err)
	}
}

// A run delivers at most reminderBatch reminders, oldest first; the rest
// are due at the next.
func TestDeliveryRunIsBounded(t *testing.T) {
	fixture := newSystemRows(t)
	if _, err := fixture.pool.Exec(context.Background(),
		`INSERT INTO reminders (id, channel_id, user_id, content, remind_at)
		 SELECT gen_random_uuid(), $1, $2, 'number ' || n, now() + n * interval '1 minute' FROM generate_series(1, $3) AS n`,
		fixture.channel.ID, authctx.UserID(fixture.ada), reminderBatch+3); err != nil {
		t.Fatal(err)
	}
	if report := fixture.deliver(later()); report != (ReminderReport{Delivered: reminderBatch}) {
		t.Fatalf("the first run: %s, want %d delivered", describe(report), reminderBatch)
	}
	var oldest string
	if err := fixture.pool.QueryRow(context.Background(), `SELECT content FROM reminders ORDER BY remind_at LIMIT 1`).Scan(&oldest); err != nil {
		t.Fatal(err)
	}
	if want := fmt.Sprintf("number %d", reminderBatch+1); oldest != want || fixture.waiting() != 3 {
		t.Errorf("after the first run %d wait, the oldest %q; want 3 and %q", fixture.waiting(), oldest, want)
	}
	if report := fixture.deliver(later()); report != (ReminderReport{Delivered: 3}) {
		t.Errorf("the second run: %s, want the last 3 delivered", describe(report))
	}
}

// Two dispatchers that run at once deliver each reminder once: the one
// that holds the channel claims it, and the other finds it gone.
func TestTwoDispatchersDeliverEachReminderOnce(t *testing.T) {
	fixture := newSystemRows(t)
	const perChannel = 15
	channels := []string{fixture.channel.ID, fixture.textChannel("side-porch"), fixture.conversation(fixture.ada, fixture.bea).ID}
	for _, channelID := range channels {
		for index := range perChannel {
			fixture.remind(fixture.ada, channelID, fmt.Sprintf("reminder %d", index), time.Duration(index+2)*time.Minute)
		}
	}
	at := later()
	var delivered atomic.Int64
	var wg sync.WaitGroup
	failures := make(chan error, 4)
	for range 4 {
		wg.Go(func() {
			report, err := fixture.svc.DeliverReminders(context.Background(), at)
			delivered.Add(report.Delivered)
			if err != nil || report.Dropped != 0 {
				failures <- fmt.Errorf("%s: %v", describe(report), err)
			}
		})
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Errorf("a dispatcher: %v", err)
	}
	if got := delivered.Load(); got != perChannel*int64(len(channels)) {
		t.Errorf("the dispatchers report %d delivered between them, want %d", got, perChannel*len(channels))
	}
	for _, channelID := range channels {
		seen := map[string]int{}
		for _, row := range fixture.reminderRows(channelID) {
			seen[row.content]++
		}
		if len(seen) != perChannel {
			t.Errorf("channel %s holds %d different reminders, want %d", channelID, len(seen), perChannel)
		}
		for content, count := range seen {
			if count != 1 {
				t.Errorf("channel %s: %q was posted %d times", channelID, content, count)
			}
		}
	}
	if got := fixture.waiting(); got != 0 {
		t.Errorf("%d reminders still wait", got)
	}
}

// stalledDelivery starts a delivery run that waits on blocked and gives
// it time to get there. done carries what the run did.
type deliveryResult struct {
	report ReminderReport
	err    error
}

func (f *systemRows) startDelivery() chan deliveryResult {
	done := make(chan deliveryResult, 1)
	go func() {
		report, err := f.svc.DeliverReminders(context.Background(), later())
		done <- deliveryResult{report, err}
	}()
	time.Sleep(settleFor)
	return done
}

// An Undo that lands while delivery waits for the channel wins: delivery
// then finds no reminder to claim and posts nothing.
func TestUndoBeforeDeliveryClaims(t *testing.T) {
	fixture := newSystemRows(t)
	ctx := context.Background()
	reminder := fixture.remind(fixture.ada, "", "Order the pizza", time.Hour)
	tx, err := fixture.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := fixture.svc.q.WithTx(tx).LockChannel(ctx, fixture.channel.ID); err != nil {
		t.Fatal(err)
	}
	done := fixture.startDelivery()
	if err := fixture.unremind(fixture.ada, reminder.Id); err != nil {
		t.Fatalf("Undo while delivery waits for the channel: %v", err)
	}
	_ = tx.Rollback(ctx)
	if result := <-done; result.err != nil || result.report != (ReminderReport{}) {
		t.Errorf("delivery: %s, err %v; want nothing done", describe(result.report), result.err)
	}
	if rows := fixture.reminderRows(fixture.channel.ID); len(rows) != 0 {
		t.Errorf("a reminder taken back was posted: %+v", rows)
	}
}

// An Undo that lands after delivery has claimed the reminder waits for
// it and is told not found: the reminder is posted, once.
func TestUndoAfterDeliveryClaims(t *testing.T) {
	fixture := newSystemRows(t)
	release := fixture.holdReminderRows()
	reminder := fixture.remind(fixture.ada, "", "held", time.Hour)
	done := fixture.startDelivery()
	undone := make(chan error, 1)
	go func() { undone <- fixture.unremind(fixture.ada, reminder.Id) }()
	select {
	case err := <-undone:
		t.Fatalf("Undo did not wait for the delivery that holds the reminder: %v", err)
	case <-time.After(settleFor):
	}
	release()
	if result := <-done; result.err != nil || result.report != (ReminderReport{Delivered: 1}) {
		t.Errorf("delivery: %s, err %v; want one delivered", describe(result.report), result.err)
	}
	if err := <-undone; connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("Undo after the claim: err = %v, want NotFound", err)
	}
	if rows := fixture.reminderRows(fixture.channel.ID); len(rows) != 1 {
		t.Errorf("%d rows posted, want one", len(rows))
	}
}

// Undo and delivery let loose on the same reminders: each one is either
// taken back or posted, never both and never neither.
func TestUndoRacingDelivery(t *testing.T) {
	fixture := newSystemRows(t)
	const count = 40
	ids := make([]string, count)
	for index := range ids {
		ids[index] = fixture.remind(fixture.ada, "", fmt.Sprintf("reminder %d", index), time.Hour).Id
	}
	undone := make([]bool, count)
	var wg sync.WaitGroup
	failures := make(chan error, count+2)
	for range 2 {
		wg.Go(func() {
			if _, err := fixture.svc.DeliverReminders(context.Background(), later()); err != nil {
				failures <- err
			}
		})
	}
	for index, id := range ids {
		wg.Go(func() {
			switch err := fixture.unremind(fixture.ada, id); {
			case err == nil:
				undone[index] = true
			case connect.CodeOf(err) != connect.CodeNotFound:
				failures <- err
			}
		})
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Errorf("racing: %v", err)
	}
	posted := map[string]int{}
	for _, row := range fixture.reminderRows(fixture.channel.ID) {
		posted[row.content]++
	}
	for index := range ids {
		times := posted[fmt.Sprintf("reminder %d", index)]
		if (undone[index] && times != 0) || (!undone[index] && times != 1) {
			t.Errorf("reminder %d: taken back = %v, posted %d times", index, undone[index], times)
		}
	}
	if got := fixture.waiting(); got != 0 {
		t.Errorf("%d reminders still wait", got)
	}
}

// A channel deleted while delivery waits for it takes its reminders with
// it: delivery finds no channel, posts nothing and fails nothing.
func TestChannelDeletedBeforeDeliveryLocksIt(t *testing.T) {
	fixture := newSystemRows(t)
	ctx := context.Background()
	room := fixture.textChannel("side-porch")
	fixture.remind(fixture.ada, room, "Order the pizza", time.Hour)
	fixture.remind(fixture.ada, "", "Bring the dice", time.Hour)
	tx, err := fixture.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// The delete holds the channel row and has cascaded into reminders.
	if _, err := tx.Exec(ctx, `DELETE FROM channels WHERE id = $1`, room); err != nil {
		t.Fatal(err)
	}
	done := fixture.startDelivery()
	select {
	case result := <-done:
		t.Fatalf("delivery did not wait for the channel: %s, %v", describe(result.report), result.err)
	default:
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if result := <-done; result.err != nil || result.report != (ReminderReport{Delivered: 1}) {
		t.Errorf("delivery: %s, err %v; want the other channel's delivered and no failure", describe(result.report), result.err)
	}
	if got := fixture.waiting(); got != 0 {
		t.Errorf("%d reminders still wait", got)
	}
}

// A channel delete that lands while delivery holds the channel waits for
// it: the reminder is posted, then the channel goes, and neither fails.
func TestChannelDeletedAfterDeliveryLocksIt(t *testing.T) {
	fixture := newSystemRows(t)
	release := fixture.holdReminderRows()
	room := fixture.textChannel("side-porch")
	fixture.remind(fixture.ada, room, "held", time.Hour)
	space := fixture.svc.bus.(*events.InProcBus).Subscribe(events.SpaceTopic(fixture.spaceID))
	defer space.Close()
	done := fixture.startDelivery()
	deleted := make(chan error, 1)
	go func() {
		_, err := fixture.svc.DeleteChannel(fixture.ada, connect.NewRequest(&chatv1.DeleteChannelRequest{ChannelId: room}))
		deleted <- err
	}()
	select {
	case err := <-deleted:
		t.Fatalf("the delete did not wait for the delivery that holds the channel: %v", err)
	case <-time.After(settleFor):
	}
	release()
	if result := <-done; result.err != nil || result.report != (ReminderReport{Delivered: 1}) {
		t.Errorf("delivery: %s, err %v; want one delivered", describe(result.report), result.err)
	}
	if err := <-deleted; err != nil {
		t.Errorf("the channel delete: %v", err)
	}
	var created int
	for _, event := range everyEvent(space) {
		if event.GetMessageCreated().GetContent() == "held" {
			created++
		}
	}
	if created != 1 {
		t.Errorf("the space heard the reminder %d times, want once", created)
	}
}

// Channel deletes and delivery let loose on the same channels: nothing
// deadlocks, nothing fails, and no reminder is left behind.
func TestChannelDeleteRacingDelivery(t *testing.T) {
	fixture := newSystemRows(t)
	const rooms = 12
	channelIDs := make([]string, rooms)
	for index := range channelIDs {
		channelIDs[index] = fixture.textChannel(fmt.Sprintf("room-%d", index))
		for _, setter := range []context.Context{fixture.ada, fixture.bea, fixture.cat} {
			fixture.remind(setter, channelIDs[index], "Order the pizza", time.Hour)
		}
	}
	var wg sync.WaitGroup
	failures := make(chan error, rooms+3)
	for range 3 {
		wg.Go(func() {
			if report, err := fixture.svc.DeliverReminders(context.Background(), later()); err != nil {
				failures <- fmt.Errorf("delivery (%s): %w", describe(report), err)
			}
		})
	}
	for _, channelID := range channelIDs {
		wg.Go(func() {
			if _, err := fixture.svc.DeleteChannel(fixture.ada, connect.NewRequest(&chatv1.DeleteChannelRequest{ChannelId: channelID})); err != nil {
				failures <- fmt.Errorf("delete channel: %w", err)
			}
		})
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		if strings.Contains(err.Error(), "deadlock") {
			t.Errorf("deadlock: %v", err)
		} else {
			t.Errorf("racing: %v", err)
		}
	}
	if got := fixture.waiting(); got != 0 {
		t.Errorf("%d reminders outlived their channels", got)
	}
}
