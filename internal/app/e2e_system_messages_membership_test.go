package app_test

import (
	"strings"
	"testing"
	"time"
)

// A private channel's membership rows reach only its people: the "added"
// row everyone in it, the "left" row only those who remain. The person
// removed and someone outside the channel receive neither, live or in
// history.
func TestE2EMembershipRowsReachOnlyThePeopleIn(t *testing.T) {
	site := newHarness(t)
	casey := site.person("casey")
	stoop, _ := site.space(casey, "The Stoop")
	ada, bea, dee := site.person("ada"), site.person("bea"), site.person("dee")
	code := site.invite(casey, stoop)
	for _, person := range []string{ada, bea, dee} {
		site.join(person, code)
	}
	captains := site.rpc(casey, "stoop.chat.v1.ChatService/CreateChannel", map[string]any{
		"spaceId": stoop, "name": "captains", "private": true,
	}).expect(t, "ok").str("channel.id")
	adaSocket, beaSocket, deeSocket := site.listen(ada), site.listen(bea), site.listen(dee)

	site.rpc(casey, "stoop.chat.v1.ChatService/AddChannelMembers", map[string]any{
		"channelId": captains, "userIds": []string{site.userID(ada), site.userID(dee)},
	}).expect(t, "ok")
	site.rpc(casey, "stoop.chat.v1.ChatService/RemoveChannelMember", map[string]any{
		"channelId": captains, "userId": site.userID(dee),
	}).expect(t, "ok")

	var addedID, leftID string
	for _, message := range site.messages(ada, captains) {
		event, _ := message["event"].(map[string]any)
		author, _ := message["author"].(map[string]any)
		switch {
		case event["membersAdded"] != nil && author["id"] == site.userID(casey):
			addedID, _ = message["id"].(string)
		case event["memberLeft"] != nil && author["id"] == site.userID(dee):
			leftID, _ = message["id"].(string)
		}
	}
	if addedID == "" || leftID == "" {
		t.Fatalf("history for someone in the channel lacks a row: added %q, left %q", addedID, leftID)
	}
	site.list(dee, captains).expect(t, "not_found")
	site.list(bea, captains).expect(t, "not_found")

	time.Sleep(300 * time.Millisecond)
	if frames := adaSocket(); !strings.Contains(frames, addedID) || !strings.Contains(frames, leftID) {
		t.Error("someone in the channel was not sent both rows")
	}
	if frames := deeSocket(); !strings.Contains(frames, addedID) || strings.Contains(frames, leftID) {
		t.Error("the person removed was not sent the row adding them, or was sent the row recording their removal")
	}
	if frames := beaSocket(); strings.Contains(frames, captains) {
		t.Error("someone outside the channel was sent something of it")
	}
}
