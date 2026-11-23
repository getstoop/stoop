package app_test

import "testing"

// A channel change records system messages, published as message_created
// on the space's topic; an outgoing hook never receives them. Deliveries
// go out in order, so the first one after the changes being the message
// sent after them means none was sent for the changes.
func TestE2ESystemMessagesSkipOutgoingHooks(t *testing.T) {
	server := newHarness(t)
	casey := server.person("casey")
	stoop, general := server.space(casey, "The Stoop")
	rcv := newReceiver(t)
	server.rpc(casey, "stoop.instance.v1.InstanceService/UpdateSettings", map[string]any{"webhooksAllowPrivateTargets": true}).expect(t, "ok")
	server.outgoing(casey, stoop, rcv.srv.URL, "message.created")

	server.rpc(casey, "stoop.chat.v1.ChatService/UpdateChannel", map[string]any{
		"channelId": general, "name": "porch", "topic": "Friday nights",
	}).expect(t, "ok")
	server.send(casey, general, "after the rename").expect(t, "ok")
	first := rcv.next(t)
	if first.headers.Get("Stoop-Event") != "message.created" || first.body["data"].(map[string]any)["content"] != "after the rename" {
		t.Errorf("first delivery after the rename = %s %s, want the message sent after it", first.headers.Get("Stoop-Event"), first.raw)
	}
	rcv.none(t)
}
