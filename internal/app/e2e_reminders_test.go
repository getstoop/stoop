package app_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

const chatService = "stoop.chat.v1.ChatService/"

// remindersHarness is a server and a pool onto its database, for moving
// a reminder's time and the delivery job's next run into the past.
func remindersHarness(t *testing.T) (*harness, *pgxpool.Pool) {
	t.Helper()
	databaseURL := dbtest.NewURL(t)
	site := newHarnessOn(t, databaseURL)
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return site, pool
}

// deliverRemindersNow makes every waiting reminder due and the delivery
// job run on the dispatcher's next pass, then waits for that run.
func deliverRemindersNow(t *testing.T, site *harness, pool *pgxpool.Pool, admin string) map[string]any {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `UPDATE reminders SET remind_at = now() - interval '1 minute'`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE job_schedules SET next_due = now() WHERE kind = 'deliver_reminders'`); err != nil {
		t.Fatal(err)
	}
	return site.awaitJobOutcome(admin, "deliver_reminders", "JOB_OUTCOME_SUCCEEDED", 15*time.Second)
}

func remindIn(site *harness, token, channelID, text string, ahead time.Duration) reply {
	return site.rpc(token, chatService+"CreateReminder", map[string]any{
		"channelId": channelID, "text": text, "remindAt": time.Now().Add(ahead).UTC().Format(time.RFC3339),
	})
}

// Setting and taking back a reminder are gated like posting: a
// credential needs messages.post, a read-only one is refused, and each
// refusal a client words comes back with its code.
func TestE2EReminderRequests(t *testing.T) {
	site, _ := remindersHarness(t)
	casey := site.person("casey")
	ada := site.person("ada")
	spaceID, general := site.space(casey, "The Stoop")
	site.join(ada, site.invite(casey, spaceID))
	undo := func(token, id string) reply {
		return site.rpc(token, chatService+"DeleteReminder", map[string]any{"id": id})
	}

	set := remindIn(site, ada, general, "Order the pizza", 20*time.Minute).expect(t, "ok")
	stored, err := time.Parse(time.RFC3339, set.str("remindAt"))
	if set.str("id") == "" || err != nil || stored.Second() != 0 || time.Until(stored) > 20*time.Minute || time.Until(stored) < 18*time.Minute {
		t.Fatalf("CreateReminder answered %s, want an id and the time on the whole minute", set.raw)
	}
	if rows := site.messages(casey, general); len(rows) != 0 {
		t.Errorf("setting a reminder posted %v", rows)
	}

	remindIn(site, "", general, "Friday", time.Hour).expect(t, "unauthenticated")
	undo("", set.str("id")).expect(t, "unauthenticated")
	reader := site.pat(ada, "space.read", "messages.read")
	remindIn(site, reader, general, "Friday", time.Hour).expect(t, "permission_denied", "isn't allowed to post messages")
	undo(reader, set.str("id")).expect(t, "permission_denied", "isn't allowed to post messages")

	remindIn(site, ada, general, "", time.Hour).expect(t, "invalid_argument", "needs some text")
	remindIn(site, ada, general, "one\ntwo", time.Hour).expect(t, "invalid_argument", "line break")
	remindIn(site, ada, general, "Friday", 30*time.Second).expect(t, "invalid_argument", "at least a minute")
	remindIn(site, ada, general, "Friday", 400*24*time.Hour).expect(t, "invalid_argument", "at most a year")
	site.rpc(ada, chatService+"CreateReminder", map[string]any{"channelId": general, "text": "Friday"}).
		expect(t, "invalid_argument", "needs a time")
	outsider := site.person("bea")
	remindIn(site, outsider, general, "Friday", time.Hour).expect(t, "permission_denied")

	// Only the caller's own: someone else's is not found, and so is a
	// second Undo. A token that may post takes its holder's back.
	undo(casey, set.str("id")).expect(t, "not_found", "reminder not found")
	undo(site.pat(ada, "messages.post"), set.str("id")).expect(t, "ok")
	undo(ada, set.str("id")).expect(t, "not_found", "reminder not found")
}

// The delivery job runs on its schedule: a due reminder arrives in its
// channel as a row by the person who set it, which they may delete, and
// Undo then finds nothing. One whose person was deactivated meanwhile is
// dropped, which the auth module's lookup is what tells chat.
func TestE2EReminderIsDeliveredByTheJob(t *testing.T) {
	site, pool := remindersHarness(t)
	casey := site.person("casey")
	ada := site.person("ada")
	bea := site.person("bea")
	spaceID, general := site.space(casey, "The Stoop")
	code := site.invite(casey, spaceID)
	site.join(ada, code)
	site.join(bea, code)

	row := jobRow(site.rpc(casey, diagnostics+"ListJobs", map[string]any{}).expect(t, "ok"), "deliver_reminders")
	if row == nil || row["interval"] != "30s" {
		t.Fatalf("deliver_reminders = %v, want it scheduled every 30 seconds", row)
	}

	set := remindIn(site, ada, general, "Order the *pizza*", time.Hour).expect(t, "ok")
	remindIn(site, bea, general, "Bring the dice", time.Hour).expect(t, "ok")
	site.rpc(casey, "stoop.instance.v1.InstanceService/SetUserActive", map[string]any{"userId": site.userID(bea), "active": false}).
		expect(t, "ok")

	ran := deliverRemindersNow(t, site, pool, casey)
	counters, _ := ran["counters"].(map[string]any)
	if counters["reminders_delivered"] != "1" || counters["reminders_dropped"] != "1" {
		t.Errorf("the run's counters = %v, want one delivered and one dropped", counters)
	}
	rows := site.messages(casey, general)
	if len(rows) != 1 {
		t.Fatalf("the channel holds %v, want ada's reminder alone", rows)
	}
	posted := rows[0]
	event, _ := posted["event"].(map[string]any)
	author, _ := posted["author"].(map[string]any)
	if _, isReminder := event["reminder"]; !isReminder || posted["content"] != "Order the *pizza*" || author["id"] != site.userID(ada) || posted["quiet"] != nil {
		t.Errorf("the row = %v, want ada's reminder, its text as typed, not quiet", posted)
	}
	site.rpc(ada, chatService+"DeleteReminder", map[string]any{"id": set.str("id")}).expect(t, "not_found", "reminder not found")

	messageID, _ := posted["id"].(string)
	site.rpc(site.person("cat"), chatService+"DeleteMessage", map[string]any{"messageId": messageID}).expect(t, "permission_denied")
	site.rpc(ada, chatService+"DeleteMessage", map[string]any{"messageId": messageID}).expect(t, "ok")
	if rows := site.messages(casey, general); len(rows) != 0 {
		t.Errorf("after its author deleted it the channel holds %v", rows)
	}
}
