package app_test

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

// The text shaping every module shares (internal/text), seen from the
// API: pasted line breaks collapse to one line, and a preview is cut to
// its budget with an ellipsis and no space before it. (STOOP-385)
func TestE2ETextShaping(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	ada := h.person("ada")
	chat := "stoop.chat.v1.ChatService/"

	// A space name, description and channel topic each become one line.
	created := h.rpc(casey, chat+"CreateSpace", map[string]any{"name": "  The\n\tStoop  "}).expect(t, "ok")
	stoop, general := created.str("space.id"), created.str("defaultChannel.id")
	if got := created.str("space.name"); got != "The Stoop" {
		t.Errorf("space name = %q", got)
	}
	updated := h.rpc(casey, chat+"UpdateSpace", map[string]any{"spaceId": stoop, "description": " where \r\n\n  we   sit "}).expect(t, "ok")
	if got := updated.str("space.description"); got != "where we sit" {
		t.Errorf("space description = %q", got)
	}
	topic := h.rpc(casey, chat+"UpdateChannel", map[string]any{"channelId": general, "topic": "status:\n\tall\n good"}).expect(t, "ok")
	if got := topic.str("channel.topic"); got != "status: all good" {
		t.Errorf("channel topic = %q", got)
	}

	// So does a profile field.
	profile := h.rpc(ada, "stoop.auth.v1.AuthService/UpdateProfile", map[string]any{"displayName": "Ada", "bio": "I\nlike\n\n  stoops"}).expect(t, "ok")
	if got := profile.str("user.bio"); got != "I like stoops" {
		t.Errorf("bio = %q", got)
	}

	// A reply's quoted preview and the activity item it raises are cut to
	// the preview budget; a cut that lands after a space drops the space.
	h.join(ada, h.invite(casey, stoop))
	long := strings.Repeat("x", 138) + " and this part is past the preview budget"
	first := h.send(casey, general, long).expect(t, "ok").str("message.id")
	reply := h.rpc(ada, chat+"SendMessage", map[string]any{"channelId": general, "content": long, "replyToMessageId": first}).expect(t, "ok")
	wantPreview := strings.Repeat("x", 138) + "…"
	if got := reply.str("message.replyTo.preview"); got != wantPreview {
		t.Errorf("reply preview = %q (%d runes)", got, utf8.RuneCountInString(got))
	}
	items := h.rpc(casey, chat+"ListActivity", map[string]any{}).expect(t, "ok").list("items")
	if len(items) != 1 {
		t.Fatalf("casey has %d activity items, want 1", len(items))
	}
	item := items[0].(map[string]any)
	if got, _ := item["preview"].(string); got != wantPreview {
		t.Errorf("activity preview = %q", got)
	}
}

// An optional time reaches the wire as a timestamp or not at all
// (internal/pbtime), across every module that renders one. (STOOP-385)
func TestE2EOptionalTimestamps(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	ada := h.person("ada")
	chat := "stoop.chat.v1.ChatService/"
	stoop, general := h.space(casey, "The Stoop")
	h.join(ada, h.invite(casey, stoop))

	// chat: an invite with no expiry carries none; one with an expiry
	// carries it; revoking stamps it.
	open := h.rpc(casey, chat+"CreateInvite", map[string]any{"spaceId": stoop}).expect(t, "ok")
	if open.str("invite.expiresAt") != "" || open.str("invite.revokedAt") != "" {
		t.Errorf("an open invite carries %s", open.raw)
	}
	timed := h.rpc(casey, chat+"CreateInvite", map[string]any{"spaceId": stoop, "expiresIn": "3600s"}).expect(t, "ok")
	if left := until(t, timed.body["invite"].(map[string]any)["expiresAt"]); left < 59*time.Minute || left > time.Hour {
		t.Errorf("a one-hour invite expires in %v", left)
	}
	revoked := h.rpc(casey, chat+"RevokeInvite", map[string]any{"inviteId": timed.str("invite.id")}).expect(t, "ok")
	if revoked.str("invite.revokedAt") == "" {
		t.Errorf("a revoked invite carries no revokedAt: %s", revoked.raw)
	}

	// chat: a message is unedited until it is edited; an activity item is
	// unread until it is read.
	sent := h.send(casey, general, "hello @ada").expect(t, "ok")
	if sent.str("message.editedAt") != "" {
		t.Errorf("a new message carries editedAt: %s", sent.raw)
	}
	edited := h.rpc(casey, chat+"EditMessage", map[string]any{"messageId": sent.str("message.id"), "content": "hello again @ada"}).expect(t, "ok")
	if edited.str("message.editedAt") == "" {
		t.Errorf("an edited message carries no editedAt: %s", edited.raw)
	}
	items := h.rpc(ada, chat+"ListActivity", map[string]any{}).expect(t, "ok").list("items")
	if len(items) != 1 {
		t.Fatalf("ada has %d activity items, want 1", len(items))
	}
	mention := items[0].(map[string]any)
	if mention["readAt"] != nil {
		t.Errorf("an unread mention carries readAt: %v", mention)
	}
	h.rpc(ada, chat+"MarkActivityRead", map[string]any{"ids": []string{mention["id"].(string)}}).expect(t, "ok")
	if read := h.rpc(ada, chat+"ListActivity", map[string]any{}).expect(t, "ok").list("items")[0].(map[string]any); read["readAt"] == nil {
		t.Errorf("a read mention carries no readAt: %v", read)
	}

	// auth: do not disturb with and without an end.
	auth := "stoop.auth.v1.AuthService/"
	h.rpc(ada, auth+"SetDoNotDisturb", map[string]any{"on": true}).expect(t, "ok")
	if me := h.rpc(ada, auth+"GetMe", map[string]any{}).expect(t, "ok"); me.str("user.dndUntil") != "" {
		t.Errorf("open-ended do not disturb carries an end: %s", me.raw)
	}
	end := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339Nano)
	h.rpc(ada, auth+"SetDoNotDisturb", map[string]any{"on": true, "until": end}).expect(t, "ok")
	if me := h.rpc(ada, auth+"GetMe", map[string]any{}).expect(t, "ok"); until(t, me.str("user.dndUntil")) < 119*time.Minute {
		t.Errorf("timed do not disturb ends at %s", me.str("user.dndUntil"))
	}

	// instance: deactivation is stamped and clears again.
	instance := "stoop.instance.v1.InstanceService/"
	adaID := h.userID(ada)
	off := h.rpc(casey, instance+"SetUserActive", map[string]any{"userId": adaID, "active": false}).expect(t, "ok")
	if off.str("user.deactivatedAt") == "" || off.str("user.deletedAt") != "" {
		t.Errorf("a deactivated user carries %s", off.raw)
	}
	on := h.rpc(casey, instance+"SetUserActive", map[string]any{"userId": adaID, "active": true}).expect(t, "ok")
	if on.str("user.deactivatedAt") != "" {
		t.Errorf("a reactivated user still carries deactivatedAt: %s", on.raw)
	}

	// instance: the process start is a time; at boot no sweeper has run
	// yet, so none carries a start or a next run.
	if health := h.rpc(casey, instance+"GetHealth", map[string]any{}).expect(t, "ok"); health.str("serverStartedAt") == "" {
		t.Errorf("no serverStartedAt: %s", health.raw)
	}
	for _, job := range h.rpc(casey, instance+"ListJobs", map[string]any{}).expect(t, "ok").list("jobs") {
		if fields, _ := job.(map[string]any); fields["lastStarted"] != nil || fields["nextDue"] != nil {
			t.Errorf("a job that never ran carries a time: %v", fields)
		}
	}

	// integrations: a delivered item has a finish and no next attempt.
	rcv := newReceiver(t)
	h.rpc(casey, instance+"UpdateSettings", map[string]any{"webhooksAllowPrivateTargets": true}).expect(t, "ok")
	hookID, _ := h.outgoing(casey, stoop, rcv.srv.URL+"/hook", "message.created")
	h.send(casey, general, "delivered").expect(t, "ok")
	rcv.next(t)
	var done map[string]any
	for attempt := 0; attempt < 50 && done == nil; attempt++ {
		for _, entry := range h.rpc(casey, "stoop.integrations.v1.IntegrationService/ListDeliveries", map[string]any{"webhookId": hookID}).expect(t, "ok").list("deliveries") {
			if row := entry.(map[string]any); row["statusCode"] == float64(200) {
				done = row
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	if done == nil {
		t.Fatal("the delivery was never recorded")
	}
	if done["finishedAt"] == nil || done["nextAttemptAt"] != nil {
		t.Errorf("a delivered item carries finishedAt=%v nextAttemptAt=%v", done["finishedAt"], done["nextAttemptAt"])
	}
}
