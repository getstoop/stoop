package app_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// An outgoing hook POSTs signed events to a URL somebody else hosts. The
// receiver here is an httptest server; the pipeline behind it is the
// real bus subscriber and the real lease worker, started by the harness.

// delivery is one POST the receiver got.
type delivery struct {
	headers http.Header
	body    map[string]any
	raw     []byte
}

type receiver struct {
	srv    *httptest.Server
	got    chan delivery
	status atomic.Int32
}

func newReceiver(t *testing.T) *receiver {
	t.Helper()
	r := &receiver{got: make(chan delivery, 32)}
	r.status.Store(http.StatusOK)
	r.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		raw, _ := io.ReadAll(req.Body)
		d := delivery{headers: req.Header.Clone(), raw: raw}
		_ = json.Unmarshal(raw, &d.body)
		r.got <- d
		w.WriteHeader(int(r.status.Load()))
	}))
	t.Cleanup(r.srv.Close)
	return r
}

// next waits for a delivery, or fails.
func (r *receiver) next(t *testing.T) delivery {
	t.Helper()
	select {
	case d := <-r.got:
		return d
	case <-time.After(5 * time.Second):
		t.Fatal("no delivery arrived")
		return delivery{}
	}
}

// none asserts nothing arrives for a while.
func (r *receiver) none(t *testing.T) {
	t.Helper()
	select {
	case d := <-r.got:
		t.Fatalf("unexpected delivery: %s %s", d.headers.Get("Stoop-Event"), d.raw)
	case <-time.After(700 * time.Millisecond):
	}
}

// verify checks a delivery's signature against the secret the way the
// docs tell a receiver to.
func verify(t *testing.T, secret string, d delivery) {
	t.Helper()
	sig := d.headers.Get("Stoop-Signature")
	var ts, v1 string
	for _, part := range strings.Split(sig, ",") {
		k, v, _ := strings.Cut(part, "=")
		switch k {
		case "t":
			ts = v
		case "v1":
			v1 = v
		}
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + "."))
	mac.Write(d.raw)
	if want := hex.EncodeToString(mac.Sum(nil)); want != v1 {
		t.Errorf("signature %q does not verify (want v1=%s)", sig, want)
	}
}

func (h *harness) outgoing(admin, spaceID, url string, events ...string) (id, secret string) {
	h.t.Helper()
	r := h.rpc(admin, "stoop.integrations.v1.IntegrationService/CreateOutgoing", map[string]any{
		"spaceId": spaceID, "name": "receiver", "url": url, "eventTypes": events,
	}).expect(h.t, "ok")
	return r.str("webhook.id"), r.str("secret")
}

func TestE2EOutgoingDeliveries(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	ada := h.person("ada")
	stoop, general := h.space(casey, "The Stoop")
	h.join(ada, h.invite(casey, stoop))
	rcv := newReceiver(t)

	// A loopback receiver is refused until the operator allows private
	// targets; the switch is the only thing that changes.
	h.rpc(casey, "stoop.integrations.v1.IntegrationService/CreateOutgoing", map[string]any{
		"spaceId": stoop, "name": "receiver", "url": rcv.srv.URL, "eventTypes": []string{"message.created"},
	}).expect(t, "failed_precondition", "egress policy")
	h.rpc(casey, "stoop.instance.v1.InstanceService/UpdateSettings", map[string]any{"webhooksAllowPrivateTargets": true}).expect(t, "ok")
	hookID, secret := h.outgoing(casey, stoop, rcv.srv.URL+"/hook?token=receiver-secret", "message.created", "member.joined", "channel.created")

	// A message lands as a signed, sequenced, self-contained envelope.
	h.send(casey, general, "first").expect(t, "ok")
	d := rcv.next(t)
	verify(t, secret, d)
	if d.headers.Get("Stoop-Event") != "message.created" || d.headers.Get("Stoop-Sequence") != "1" || d.headers.Get("Stoop-Attempt") != "1" ||
		!strings.HasPrefix(d.headers.Get("User-Agent"), "Stoop/") || d.headers.Get("Stoop-Delivery") == "" {
		t.Errorf("headers = %v", d.headers)
	}
	if d.body["type"] != "message.created" || d.body["space"].(map[string]any)["name"] != "The Stoop" || d.body["data"].(map[string]any)["content"] != "first" {
		t.Errorf("body = %s", d.raw)
	}
	h.send(casey, general, "second").expect(t, "ok")
	if d := rcv.next(t); d.headers.Get("Stoop-Sequence") != "2" {
		t.Errorf("second sequence = %s", d.headers.Get("Stoop-Sequence"))
	}

	// The Test button, a channel event, and a member event all use the
	// same envelope; a direct message never reaches a hook at all.
	h.rpc(casey, "stoop.integrations.v1.IntegrationService/TestWebhook", map[string]any{"id": hookID}).expect(t, "ok")
	if d := rcv.next(t); d.headers.Get("Stoop-Event") != "webhook.test" {
		t.Errorf("test event = %s", d.headers.Get("Stoop-Event"))
	}
	h.rpc(casey, "stoop.chat.v1.ChatService/CreateChannel", map[string]any{"spaceId": stoop, "name": "alerts"}).expect(t, "ok")
	if d := rcv.next(t); d.headers.Get("Stoop-Event") != "channel.created" {
		t.Errorf("channel event = %s", d.headers.Get("Stoop-Event"))
	}
	dm := h.rpc(casey, "stoop.chat.v1.ChatService/OpenDirectMessage", map[string]any{"userIds": []string{h.userID(ada)}}).expect(t, "ok")
	h.send(casey, dm.str("directMessage.channel.id"), "private").expect(t, "ok")
	rcv.none(t)

	// Members see the receiver's host and never its path or the secret;
	// the admin sees the URL, and nobody sees the secret again.
	listed := h.rpc(ada, "stoop.integrations.v1.IntegrationService/ListWebhooks", map[string]any{"spaceId": stoop}).expect(t, "ok")
	if out := listed.list("outgoing"); len(out) != 1 || out[0].(map[string]any)["url"] != rcv.srv.URL {
		t.Errorf("member's view of the target = %v", out)
	}
	if strings.Contains(listed.raw, "receiver-secret") || strings.Contains(listed.raw, secret) {
		t.Error("a member's listing carried a secret")
	}
	admins := h.rpc(casey, "stoop.integrations.v1.IntegrationService/ListWebhooks", map[string]any{"spaceId": stoop}).expect(t, "ok")
	if !strings.Contains(admins.raw, "token=receiver-secret") || strings.Contains(admins.raw, secret) {
		t.Error("the admin's listing shows the URL and never the signing secret")
	}

	// A rotated secret signs the next delivery.
	rotated := h.rpc(casey, "stoop.integrations.v1.IntegrationService/RotateSecret", map[string]any{"id": hookID}).expect(t, "ok").str("secret")
	if rotated == "" || rotated == secret {
		t.Fatal("rotate returned no new secret")
	}
	h.send(casey, general, "third").expect(t, "ok")
	verify(t, rotated, rcv.next(t))

	// The operator's switch stops deliveries and the Test button alike.
	h.rpc(casey, "stoop.instance.v1.InstanceService/UpdateSettings", map[string]any{"webhooksOutgoing": false}).expect(t, "ok")
	h.rpc(casey, "stoop.integrations.v1.IntegrationService/TestWebhook", map[string]any{"id": hookID}).expect(t, "unavailable")
	h.send(casey, general, "while off").expect(t, "ok")
	rcv.none(t)
	h.rpc(casey, "stoop.instance.v1.InstanceService/UpdateSettings", map[string]any{"webhooksOutgoing": true}).expect(t, "ok")

	// 410 Gone disables the hook with a reason; the failed delivery keeps
	// its body and can be sent again once the hook is back on.
	rcv.status.Store(http.StatusGone)
	h.send(casey, general, "gone").expect(t, "ok")
	rcv.next(t)
	var hook map[string]any
	for i := 0; i < 50 && hook == nil; i++ {
		for _, o := range h.rpc(casey, "stoop.integrations.v1.IntegrationService/ListWebhooks", map[string]any{"spaceId": stoop}).expect(t, "ok").list("outgoing") {
			if om := o.(map[string]any); om["enabled"] != true {
				hook = om
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	if hook == nil || !strings.Contains(hook["disabledReason"].(string), "410") {
		t.Fatalf("hook after a 410 = %v", hook)
	}
	var dead map[string]any
	for _, dl := range h.rpc(casey, "stoop.integrations.v1.IntegrationService/ListDeliveries", map[string]any{"webhookId": hookID}).expect(t, "ok").list("deliveries") {
		if dm := dl.(map[string]any); dm["statusCode"] == float64(410) {
			dead = dm
		}
	}
	if dead == nil {
		t.Fatal("the 410 delivery isn't in the log")
	}
	h.rpc(casey, "stoop.integrations.v1.IntegrationService/RedeliverDelivery", map[string]any{"deliveryId": dead["id"]}).expect(t, "failed_precondition", "disabled")
	rcv.status.Store(http.StatusOK)
	h.rpc(casey, "stoop.integrations.v1.IntegrationService/UpdateOutgoing", map[string]any{"id": hookID, "enabled": true}).expect(t, "ok")
	again := h.rpc(casey, "stoop.integrations.v1.IntegrationService/RedeliverDelivery", map[string]any{"deliveryId": dead["id"]}).expect(t, "ok")
	d = rcv.next(t)
	if d.headers.Get("Stoop-Delivery") != again.str("delivery.id") || d.body["data"].(map[string]any)["content"] != "gone" {
		t.Errorf("redelivery = %v %s", d.headers.Get("Stoop-Delivery"), d.raw)
	}
	// A delivered item's body is not kept, so it can't be sent twice.
	h.rpc(casey, "stoop.integrations.v1.IntegrationService/RedeliverDelivery", map[string]any{"deliveryId": again.str("delivery.id")}).expect(t, "failed_precondition", "not kept")

	// A hook pointed at one of this server's own incoming URLs can't loop:
	// the delivery is refused by the hook handler and logged as a 403.
	bot := h.bot(casey, "echo")
	h.addBot(casey, bot, stoop)
	_, ownURL := h.hook(casey, bot, general, "echo")
	loopID, _ := h.outgoing(casey, stoop, ownURL, "message.created")
	h.send(casey, general, "loop?").expect(t, "ok")
	rcv.next(t) // the receiver still gets it
	var looped map[string]any
	for i := 0; i < 50 && looped == nil; i++ {
		for _, dl := range h.rpc(casey, "stoop.integrations.v1.IntegrationService/ListDeliveries", map[string]any{"webhookId": loopID}).expect(t, "ok").list("deliveries") {
			if dm := dl.(map[string]any); dm["statusCode"] == float64(403) {
				looped = dm
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	if looped == nil {
		t.Error("a delivery into our own hook wasn't refused")
	}
	if len(h.messages(casey, general)) > 8 {
		t.Errorf("the loop posted: %d messages", len(h.messages(casey, general)))
	}
}
