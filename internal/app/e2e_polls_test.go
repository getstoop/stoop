package app_test

import "testing"

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
