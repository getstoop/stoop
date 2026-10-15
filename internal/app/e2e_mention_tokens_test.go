package app_test

import (
	"strings"
	"testing"
)

// Mentions are stored as tokens and leave the server as text: a message
// read back over the wire, found by search, previewed in activity or
// delivered to an outgoing hook names people and groups by their
// current handles, and nothing carries a token.
func TestE2EMentionTokensLeaveAsText(t *testing.T) {
	site := newHarness(t)
	casey := site.person("casey")
	stoop, general := site.space(casey, "The Stoop")
	ada := site.person("ada")
	site.join(ada, site.invite(casey, stoop))
	chat := "stoop.chat.v1.ChatService/"
	site.rpc(casey, chat+"CreateGroup", map[string]any{
		"spaceId": stoop, "handle": "gardeners", "name": "Garden crew", "userIds": []string{site.userID(ada)},
	}).expect(t, "ok")
	site.rpc(casey, "stoop.instance.v1.InstanceService/UpdateSettings", map[string]any{"webhooksAllowPrivateTargets": true}).expect(t, "ok")
	rcv := newReceiver(t)
	site.outgoing(casey, stoop, rcv.srv.URL, "message.created")

	noToken := func(where, raw string) {
		t.Helper()
		if strings.Contains(raw, "<@") {
			t.Errorf("%s carried a token: %s", where, raw)
		}
	}
	sent := site.send(casey, general, "watering rota @ada and @@gardeners").expect(t, "ok")
	noToken("SendMessage", sent.raw)
	delivered := rcv.next(t)
	noToken("the outgoing hook", string(delivered.raw))
	if content := delivered.body["data"].(map[string]any)["content"]; content != "watering rota @ada and @@gardeners" {
		t.Errorf("the hook's content = %v", content)
	}

	site.rpc(ada, "stoop.auth.v1.AuthService/UpdateProfile", map[string]any{"displayName": "Ada", "username": "ada_k"}).expect(t, "ok")

	listed := site.list(casey, general).expect(t, "ok")
	noToken("ListMessages", listed.raw)
	if !strings.Contains(listed.raw, "watering rota @ada_k and @@gardeners") {
		t.Errorf("after the rename ListMessages = %s", listed.raw)
	}
	found := site.rpc(casey, chat+"SearchMessages", map[string]any{"spaceId": stoop, "query": "ada"}).expect(t, "ok")
	noToken("SearchMessages", found.raw)
	if len(found.list("messages")) != 1 {
		t.Errorf("searching the old handle found %s", found.raw)
	}
	activity := site.rpc(ada, chat+"ListActivity", map[string]any{}).expect(t, "ok")
	noToken("ListActivity", activity.raw)
	if !strings.Contains(activity.raw, "@ada_k") {
		t.Errorf("after the rename ListActivity = %s", activity.raw)
	}
}
