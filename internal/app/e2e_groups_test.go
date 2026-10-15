package app_test

import (
	"net/http"
	"slices"
	"testing"
)

// A group made over the wire is mentioned by its token. It reaches its
// people in a public channel, whether a person or a webhook's bot wrote
// it, and nobody in a private channel. Only an admin makes one.
func TestE2EGroupMentions(t *testing.T) {
	site := newHarness(t)
	casey := site.person("casey")
	stoop, general := site.space(casey, "The Stoop")
	ada, bea := site.person("ada"), site.person("bea")
	code := site.invite(casey, stoop)
	site.join(ada, code)
	site.join(bea, code)
	chat := "stoop.chat.v1.ChatService/"

	site.rpc(ada, chat+"CreateGroup", map[string]any{
		"spaceId": stoop, "handle": "porch", "name": "Porch", "userIds": []string{site.userID(ada)},
	}).expect(t, "permission_denied")
	group := site.rpc(casey, chat+"CreateGroup", map[string]any{
		"spaceId": stoop, "handle": "gardeners", "name": "Garden crew",
		"userIds": []string{site.userID(ada), site.userID(bea)},
	}).expect(t, "ok")
	if group.str("group.handle") != "gardeners" || group.str("group.name") != "Garden crew" {
		t.Fatalf("created group = %s", group.raw)
	}
	gardeners := groupMention(group.str("group.id"))
	if refused := site.rpc(casey, chat+"CreateGroup", map[string]any{
		"spaceId": stoop, "handle": "gardeners", "name": "Again", "userIds": []string{site.userID(ada)},
	}).expect(t, "already_exists"); refused.field() != "handle" {
		t.Errorf("a duplicate handle was refused on %q, want handle", refused.field())
	}
	if groups := site.rpc(bea, chat+"ListGroups", map[string]any{"spaceId": stoop}).expect(t, "ok").list("groups"); len(groups) != 1 {
		t.Errorf("a member lists %d groups, want 1", len(groups))
	}

	reached := func(token, channelID, content string) []string {
		t.Helper()
		var ids []string
		for _, id := range site.send(token, channelID, content).expect(t, "ok").list("message.mentionUserIds") {
			ids = append(ids, id.(string))
		}
		slices.Sort(ids)
		return ids
	}
	want := []string{site.userID(ada), site.userID(bea)}
	slices.Sort(want)
	if got := reached(casey, general, "compost Saturday "+gardeners); !slices.Equal(got, want) {
		t.Errorf("the group in #general reached %v, want ada and bea", got)
	}

	bot := site.bot(casey, "sprinkler")
	site.addBot(casey, bot, stoop)
	_, hookURL := site.hook(casey, bot, general, "Sprinkler")
	site.post(hookURL, "text/plain", gardeners+" the beds are dry").expectStatus(t, http.StatusOK)
	posted := site.message(casey, general, "the beds are dry")
	if posted == nil {
		t.Fatal("the hook's message is missing")
	}
	if ids, _ := posted["mentionUserIds"].([]any); len(ids) != 2 {
		t.Errorf("the hook's group mention reached %v, want ada and bea", posted["mentionUserIds"])
	}

	captains := site.rpc(casey, chat+"CreateChannel", map[string]any{
		"spaceId": stoop, "name": "captains", "private": true,
	}).expect(t, "ok").str("channel.id")
	site.rpc(casey, chat+"AddChannelMembers", map[string]any{
		"channelId": captains, "userIds": []string{site.userID(ada)},
	}).expect(t, "ok")
	if got := reached(casey, captains, gardeners+" in private"); len(got) != 0 {
		t.Errorf("the group in a private channel reached %v", got)
	}
}
