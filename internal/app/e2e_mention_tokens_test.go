package app_test

import (
	"net/http"
	"strings"
	"testing"
)

// Only a token mentions anyone. Content carries tokens as stored, over
// the API and to an outgoing hook; previews read them as current handles;
// a hook's plain @handle is text.
func TestE2EMentionTokensOverTheWire(t *testing.T) {
	site := newHarness(t)
	casey := site.person("casey")
	stoop, general := site.space(casey, "The Stoop")
	ada := site.person("ada")
	site.join(ada, site.invite(casey, stoop))
	adaID := site.userID(ada)
	chat := "stoop.chat.v1.ChatService/"
	site.rpc(casey, "stoop.instance.v1.InstanceService/UpdateSettings", map[string]any{"webhooksAllowPrivateTargets": true}).expect(t, "ok")
	rcv := newReceiver(t)
	site.outgoing(casey, stoop, rcv.srv.URL, "message.created")

	token := "<@u:" + adaID + ":ada>"
	sent := site.send(casey, general, "watering rota "+site.mention(ada)).expect(t, "ok")
	if content := sent.str("message.content"); content != "watering rota "+token {
		t.Errorf("SendMessage content = %q", content)
	}
	if content := rcv.next(t).body["data"].(map[string]any)["content"]; content != "watering rota "+token {
		t.Errorf("the outgoing hook's content = %v", content)
	}

	site.rpc(ada, "stoop.auth.v1.AuthService/UpdateProfile", map[string]any{"displayName": "Ada", "username": "ada_k"}).expect(t, "ok")
	if listed := site.list(casey, general).expect(t, "ok"); !strings.Contains(listed.raw, token) {
		t.Errorf("ListMessages after the rename = %s", listed.raw)
	}
	if found := site.rpc(casey, chat+"SearchMessages", map[string]any{"spaceId": stoop, "query": "ada"}).expect(t, "ok"); len(found.list("messages")) != 1 {
		t.Errorf("searching the saved handle found %s", found.raw)
	}
	activity := site.rpc(ada, chat+"ListActivity", map[string]any{}).expect(t, "ok")
	if items := activity.list("items"); len(items) != 1 || items[0].(map[string]any)["preview"] != "watering rota @ada_k" {
		t.Errorf("ListActivity after the rename = %s", activity.raw)
	}

	// A hook that writes a plain handle mentions nobody.
	bot := site.bot(casey, "sprinkler")
	site.addBot(casey, bot, stoop)
	_, hookURL := site.hook(casey, bot, general, "Sprinkler")
	site.post(hookURL, "text/plain", "@ada_k the beds are dry").expectStatus(t, http.StatusOK)
	if posted := site.message(casey, general, "the beds are dry"); posted == nil || posted["mentionUserIds"] != nil {
		t.Errorf("a hook's plain handle reached %v", posted)
	}
}
