package app_test

import (
	"testing"
	"time"
)

// Voting on and closing a poll are gated like reacting and posting: a
// credential needs messages.post, a read-only one is refused, and a
// token or a bot that may post votes and closes under the rules its
// holder meets.
func TestE2EPollCredentialGates(t *testing.T) {
	site := newHarness(t)
	casey := site.person("casey")
	ada := site.person("ada")
	spaceID, general := site.space(casey, "The Stoop")
	site.join(ada, site.invite(casey, spaceID))
	const chat = "stoop.chat.v1.ChatService/"
	ask := func(token string) string {
		t.Helper()
		return site.rpc(token, chat+"CreatePoll", map[string]any{
			"channelId": general, "question": "Friday?", "options": []string{"Yes", "No"},
		}).expect(t, "ok").str("message.id")
	}
	vote := func(token, pollID string) reply {
		return site.rpc(token, chat+"SetPollVote", map[string]any{"messageId": pollID, "optionIds": []int{1}})
	}
	shut := func(token, pollID string) reply {
		return site.rpc(token, chat+"ClosePoll", map[string]any{"messageId": pollID})
	}

	mine := ask(ada)
	vote("", mine).expect(t, "unauthenticated")
	shut("", mine).expect(t, "unauthenticated")

	reader := site.pat(ada, "space.read", "messages.read")
	vote(reader, mine).expect(t, "permission_denied", "isn't allowed to post messages")
	shut(reader, mine).expect(t, "permission_denied", "isn't allowed to post messages")

	// A token that may post acts as its holder, a member: it votes and
	// closes her own poll, and not someone else's.
	poster := site.pat(ada, "messages.post")
	theirs := ask(casey)
	vote(poster, mine).expect(t, "ok")
	shut(poster, theirs).expect(t, "permission_denied")
	shut(poster, mine).expect(t, "ok")
	vote(poster, mine).expect(t, "failed_precondition", "closed")

	// A bot in the space votes, and closes the poll it asked.
	bot := site.bot(casey, "uptime")
	site.addBot(casey, bot, spaceID)
	botToken := site.botToken(casey, bot, "messages.post")
	vote(botToken, theirs).expect(t, "ok")
	shut(botToken, theirs).expect(t, "permission_denied")
	shut(botToken, ask(botToken)).expect(t, "ok")

	// An admin's token closes someone else's poll only when it carries
	// messages.moderate as well.
	shut(site.pat(casey, "messages.post"), ask(ada)).expect(t, "permission_denied")
	shut(site.pat(casey, "messages.post", "messages.moderate"), ask(ada)).expect(t, "ok")
}

// A time poll over HTTP: times in place of options, answered earliest
// first with each option's time, voted on and closed like any poll, by a
// token that may post as well. Options and times together are refused,
// and so is a time that has passed.
func TestE2ETimePoll(t *testing.T) {
	site := newHarness(t)
	casey := site.person("casey")
	_, general := site.space(casey, "The Stoop")
	const chat = "stoop.chat.v1.ChatService/"
	base := time.Now().UTC().Truncate(time.Minute)
	stamp := func(instant time.Time) string { return instant.Format(time.RFC3339) }
	first, second := base.Add(24*time.Hour), base.Add(48*time.Hour)
	ask := func(token string, fields map[string]any) reply {
		req := map[string]any{"channelId": general, "question": "Game night?"}
		for key, value := range fields {
			req[key] = value
		}
		return site.rpc(token, chat+"CreatePoll", req)
	}

	poster := site.pat(casey, "messages.post")
	made := ask(poster, map[string]any{"times": []string{stamp(second.Add(30 * time.Second)), stamp(first)}}).expect(t, "ok")
	options := made.list("message.event.poll.options")
	if len(options) != 2 {
		t.Fatalf("options = %v, want two", options)
	}
	for index, want := range []time.Time{first, second} {
		option, _ := options[index].(map[string]any)
		if option["id"] != float64(index+1) || option["at"] != stamp(want) || option["text"] != nil {
			t.Errorf("option %d = %v, want id %d at %s with no text", index, option, index+1, stamp(want))
		}
	}
	pollID := made.str("message.id")

	ask(casey, map[string]any{"times": []string{stamp(first), stamp(second)}, "options": []string{"Yes", "No"}}).
		expect(t, "invalid_argument", "not both")
	ask(casey, map[string]any{"times": []string{stamp(first), stamp(base.Add(-time.Hour))}}).
		expect(t, "invalid_argument", "in the future")
	ask(casey, map[string]any{"times": []string{stamp(first), stamp(base.AddDate(1, 0, 1))}}).
		expect(t, "invalid_argument", "at most a year")
	ask(casey, map[string]any{"times": []string{stamp(first), stamp(first.Add(time.Second))}}).
		expect(t, "invalid_argument", "same time twice")
	ask(casey, map[string]any{"times": []string{stamp(first)}}).expect(t, "invalid_argument", "2 to 10 times")
	ask(site.pat(casey, "space.read", "messages.read"), map[string]any{"times": []string{stamp(first), stamp(second)}}).
		expect(t, "permission_denied")

	site.rpc(poster, chat+"SetPollVote", map[string]any{"messageId": pollID, "optionIds": []int{2}}).expect(t, "ok")
	site.rpc(poster, chat+"ClosePoll", map[string]any{"messageId": pollID}).expect(t, "ok")
	listed := site.rpc(casey, chat+"ListMessages", map[string]any{"channelId": general}).expect(t, "ok").list("messages")
	var winners []any
	for _, row := range listed {
		message, _ := row.(map[string]any)
		event, _ := message["event"].(map[string]any)
		if closed, ok := event["pollClosed"].(map[string]any); ok {
			winners, _ = closed["winners"].([]any)
		}
	}
	if len(winners) != 1 {
		t.Fatalf("winners = %v in %v, want one", winners, listed)
	}
	if winner, _ := winners[0].(map[string]any); winner["at"] != stamp(second) || winner["votes"] != float64(1) || winner["text"] != nil {
		t.Errorf("winner = %v, want the second time with one vote and no text", winner)
	}
}
