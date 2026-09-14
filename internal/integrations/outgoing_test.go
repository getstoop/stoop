package integrations

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	integrationsv1 "github.com/getstoop/stoop/gen/stoop/integrations/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/events"
)

// receiver is an httptest endpoint that records every delivery and
// answers with a scripted status.
type receiver struct {
	srv    *httptest.Server
	mu     sync.Mutex
	got    []delivery
	status []int
}

type delivery struct {
	headers http.Header
	body    []byte
}

func newReceiver(t *testing.T) *receiver {
	t.Helper()
	r := &receiver{}
	r.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		body, _ := io.ReadAll(req.Body)
		r.mu.Lock()
		r.got = append(r.got, delivery{headers: req.Header.Clone(), body: body})
		status := http.StatusOK
		if len(r.status) > 0 {
			status, r.status = r.status[0], r.status[1:]
		}
		r.mu.Unlock()
		if status == http.StatusTooManyRequests {
			w.Header().Set("Retry-After", "1")
		}
		if status >= 300 && status < 400 {
			w.Header().Set("Location", "http://169.254.169.254/latest/meta-data/")
		}
		w.WriteHeader(status)
	}))
	t.Cleanup(r.srv.Close)
	return r
}

func (r *receiver) deliveries() []delivery {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]delivery(nil), r.got...)
}

// outgoingFixture is the incoming fixture plus a queue, a fast ladder and
// a receiver, with private targets allowed so the receiver is reachable.
func outgoingFixture(t *testing.T) (*fixture, *receiver) {
	t.Helper()
	f := setup(t)
	f.policy.private = true
	f.svc.UseQueue(NewPostgresQueue(f.pool))
	f.svc.ladder = []time.Duration{0, 0, 0}
	return f, newReceiver(t)
}

func (f *fixture) createOutgoing(t *testing.T, url string, types []string, channel string) (*integrationsv1.OutgoingWebhook, string) {
	t.Helper()
	res, err := f.svc.CreateOutgoing(f.admin, connect.NewRequest(&integrationsv1.CreateOutgoingRequest{
		SpaceId: f.space, ChannelId: channel, Name: "receiver", Url: url, EventTypes: types,
	}))
	if err != nil {
		t.Fatal(err)
	}
	return res.Msg.Webhook, res.Msg.Secret
}

func (f *fixture) enqueue(t *testing.T, ev outgoingEvent) {
	t.Helper()
	if err := f.svc.enqueue(context.Background(), ev); err != nil {
		t.Fatal(err)
	}
}

// drain runs the worker until nothing is due.
func (f *fixture) drain(t *testing.T) {
	t.Helper()
	for range 20 {
		n, err := f.svc.deliverOnce(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if n == 0 {
			return
		}
	}
}

func message(channelID, spaceID, content string) *realtimev1.ServerEvent {
	return events.Stamp(&realtimev1.ServerEvent{Payload: &realtimev1.ServerEvent_MessageCreated{
		MessageCreated: &chatv1.Message{Id: uuid.NewString(), ChannelId: channelID, SpaceId: spaceID, Content: content},
	}})
}

func verify(t *testing.T, secret string, d delivery) map[string]any {
	t.Helper()
	sig := d.headers.Get("Stoop-Signature")
	ts, v1, ok := strings.Cut(sig, ",")
	if !ok || !strings.HasPrefix(ts, "t=") || !strings.HasPrefix(v1, "v1=") {
		t.Fatalf("signature %q", sig)
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strings.TrimPrefix(ts, "t=") + "."))
	mac.Write(d.body)
	if hex.EncodeToString(mac.Sum(nil)) != strings.TrimPrefix(v1, "v1=") {
		t.Fatalf("signature does not verify: %q over %s", sig, d.body)
	}
	if at, _ := strconv.ParseInt(strings.TrimPrefix(ts, "t="), 10, 64); time.Since(time.Unix(at, 0)) > time.Minute {
		t.Errorf("stale timestamp %s", ts)
	}
	var env map[string]any
	if err := json.Unmarshal(d.body, &env); err != nil {
		t.Fatal(err)
	}
	return env
}

func TestOutgoingDeliversSignedEvents(t *testing.T) {
	f, r := outgoingFixture(t)
	hook, secret := f.createOutgoing(t, r.srv.URL+"/hook", []string{EventMessageCreated, EventMemberJoined}, "")
	if !strings.HasPrefix(secret, "stp_whsec_") || hook.Hint != "" || hook.Sequence != 0 {
		t.Fatalf("created %+v secret %q", hook, secret)
	}

	out, ok := f.svc.translate(context.Background(), message(f.channel, f.space, "hello receiver"))
	if !ok {
		t.Fatal("message not translated")
	}
	if err := f.svc.enqueue(context.Background(), out); err != nil {
		t.Fatal(err)
	}
	f.drain(t)

	got := r.deliveries()
	if len(got) != 1 {
		t.Fatalf("deliveries = %d", len(got))
	}
	d := got[0]
	env := verify(t, secret, d)
	if d.headers.Get("Stoop-Event") != EventMessageCreated || d.headers.Get("Stoop-Sequence") != "1" || d.headers.Get("Stoop-Attempt") != "1" ||
		d.headers.Get("Stoop-Delivery") != env["id"] || d.headers.Get("Content-Type") != "application/json" || !strings.HasPrefix(d.headers.Get("User-Agent"), "Stoop/") {
		t.Errorf("headers %v", d.headers)
	}
	if env["type"] != EventMessageCreated || env["instance"] != "https://stoop.example.com" || env["space"].(map[string]any)["name"] != "Porch" ||
		env["data"].(map[string]any)["content"] != "hello receiver" {
		t.Errorf("envelope %s", d.body)
	}

	// An unsubscribed event type and a channel-filtered hook enqueue nothing.
	if err := f.svc.enqueue(context.Background(), outgoingEvent{Type: EventChannelDeleted, SpaceID: f.space, ChannelID: f.channel, Data: rawJSON(map[string]string{})}); err != nil {
		t.Fatal(err)
	}
	f.drain(t)
	if len(r.deliveries()) != 1 {
		t.Error("an unwanted event type was delivered")
	}
	other := uuid.NewString()
	if _, err := f.pool.Exec(context.Background(), `INSERT INTO channels (id, space_id, name, position) VALUES ($1, $2, 'other', 1)`, other, f.space); err != nil {
		t.Fatal(err)
	}
	f.spaces.channel[other] = f.space
	filtered, _ := f.createOutgoing(t, r.srv.URL+"/filtered", []string{EventMessageCreated, EventMemberJoined}, other)
	out, _ = f.svc.translate(context.Background(), message(f.channel, f.space, "not for the filtered hook"))
	joined, _ := f.svc.translate(context.Background(), events.Stamp(&realtimev1.ServerEvent{Payload: &realtimev1.ServerEvent_MemberJoined{
		MemberJoined: &realtimev1.MemberJoined{SpaceId: f.space, UserId: uuid.NewString()},
	}}))
	for _, ev := range []outgoingEvent{out, joined} {
		if err := f.svc.enqueue(context.Background(), ev); err != nil {
			t.Fatal(err)
		}
	}
	f.drain(t)
	byPath := map[string]int{}
	for _, d := range r.deliveries() {
		byPath[d.headers.Get("Stoop-Event")]++
	}
	if byPath[EventMessageCreated] != 2 || byPath[EventMemberJoined] != 2 {
		t.Errorf("filtered hook got the wrong events: %v", byPath)
	}
	if list, err := f.svc.ListDeliveries(f.admin, connect.NewRequest(&integrationsv1.ListDeliveriesRequest{WebhookId: filtered.Id})); err != nil || len(list.Msg.Deliveries) != 1 || list.Msg.Deliveries[0].EventType != EventMemberJoined {
		t.Errorf("filtered hook's log: %v %+v", err, list)
	}

	// Members see the hook without its secret; the DM topic never reaches it.
	list, err := f.svc.ListWebhooks(f.member, connect.NewRequest(&integrationsv1.ListWebhooksRequest{SpaceId: f.space}))
	if err != nil || len(list.Msg.Outgoing) != 2 {
		t.Fatalf("member list: %v %+v", err, list)
	}
	if strings.Contains(list.Msg.String(), "stp_whsec_") {
		t.Error("a listing carried a signing secret")
	}
	if list.Msg.Outgoing[0].Url != r.srv.URL {
		t.Errorf("a member saw more than the target host: %q", list.Msg.Outgoing[0].Url)
	}
	if full, _ := f.svc.ListWebhooks(f.admin, connect.NewRequest(&integrationsv1.ListWebhooksRequest{SpaceId: f.space})); full.Msg.Outgoing[0].Url != r.srv.URL+"/hook" {
		t.Errorf("the admin saw %q", full.Msg.Outgoing[0].Url)
	}
	if _, ok := f.svc.translate(context.Background(), message("dm-channel", "", "private")); ok {
		t.Error("a direct message was translated for hooks")
	}
}

func TestOutgoingRetriesAndDeadLetters(t *testing.T) {
	f, r := outgoingFixture(t)
	hook, secret := f.createOutgoing(t, r.srv.URL+"/flaky", []string{EventMessageCreated}, "")
	r.status = []int{500, 503, 200}
	out, _ := f.svc.translate(context.Background(), message(f.channel, f.space, "retry me"))
	f.enqueue(t, out)
	f.drain(t)
	got := r.deliveries()
	if len(got) != 3 {
		t.Fatalf("attempts = %d", len(got))
	}
	for i, d := range got {
		if d.headers.Get("Stoop-Delivery") != got[0].headers.Get("Stoop-Delivery") || d.headers.Get("Stoop-Attempt") != strconv.Itoa(i+1) {
			t.Errorf("attempt %d headers %v", i+1, d.headers)
		}
		verify(t, secret, d)
	}
	log, err := f.svc.ListDeliveries(f.admin, connect.NewRequest(&integrationsv1.ListDeliveriesRequest{WebhookId: hook.Id}))
	if err != nil || len(log.Msg.Deliveries) != 1 || log.Msg.Deliveries[0].Attempts != 3 || log.Msg.Deliveries[0].GetStatusCode() != 200 || log.Msg.Deliveries[0].FinishedAt == nil {
		t.Errorf("log after retries: %v %+v", err, log.Msg.Deliveries)
	}

	// Four failures: dead, body kept, redeliverable; a jump in sequence.
	r.status = []int{500, 500, 500, 500}
	out, _ = f.svc.translate(context.Background(), message(f.channel, f.space, "doomed"))
	f.enqueue(t, out)
	f.drain(t)
	if len(r.deliveries()) != 7 {
		t.Fatalf("attempts after a dead item = %d", len(r.deliveries()))
	}
	log, _ = f.svc.ListDeliveries(f.admin, connect.NewRequest(&integrationsv1.ListDeliveriesRequest{WebhookId: hook.Id}))
	dead := log.Msg.Deliveries[0]
	if dead.Attempts != 4 || dead.FinishedAt == nil || dead.GetStatusCode() != 500 || dead.Sequence != 2 {
		t.Errorf("dead delivery %+v", dead)
	}
	if _, err := f.svc.RedeliverDelivery(f.admin, connect.NewRequest(&integrationsv1.RedeliverDeliveryRequest{DeliveryId: log.Msg.Deliveries[1].Id})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("redelivering a success: %v", err)
	}
	again, err := f.svc.RedeliverDelivery(f.admin, connect.NewRequest(&integrationsv1.RedeliverDeliveryRequest{DeliveryId: dead.Id}))
	if err != nil {
		t.Fatal(err)
	}
	f.drain(t)
	last := r.deliveries()[len(r.deliveries())-1]
	if last.headers.Get("Stoop-Delivery") != again.Msg.Delivery.Id || last.headers.Get("Stoop-Sequence") != "2" {
		t.Errorf("redelivery headers %v", last.headers)
	}
	out, _ = f.svc.translate(context.Background(), message(f.channel, f.space, "after the gap"))
	f.enqueue(t, out)
	f.drain(t)
	if seq := r.deliveries()[len(r.deliveries())-1].headers.Get("Stoop-Sequence"); seq != "3" {
		t.Errorf("sequence after a dead item = %s", seq)
	}

	// 429 waits Retry-After (bounded by the ladder); 3xx is a failure,
	// never followed; 410 disables.
	f.svc.ladder = []time.Duration{5 * time.Second, 5 * time.Second, 5 * time.Second}
	r.status = []int{429, 200}
	out, _ = f.svc.translate(context.Background(), message(f.channel, f.space, "throttled"))
	f.enqueue(t, out)
	if n, _ := f.svc.deliverOnce(context.Background()); n != 1 {
		t.Fatal("nothing leased")
	}
	if n, _ := f.svc.deliverOnce(context.Background()); n != 0 {
		t.Error("a 429 with Retry-After was retried immediately")
	}
	f.svc.ladder = []time.Duration{0, 0, 0}
	if _, err := f.pool.Exec(context.Background(), `UPDATE webhook_deliveries SET not_before = now() - interval '1 minute' WHERE finished_at IS NULL`); err != nil {
		t.Fatal(err)
	}
	f.drain(t)
	r.status = []int{302, 302, 302, 302}
	out, _ = f.svc.translate(context.Background(), message(f.channel, f.space, "redirected"))
	f.enqueue(t, out)
	f.drain(t)
	log, _ = f.svc.ListDeliveries(f.admin, connect.NewRequest(&integrationsv1.ListDeliveriesRequest{WebhookId: hook.Id}))
	if d := log.Msg.Deliveries[0]; d.GetStatusCode() != 302 || d.FinishedAt == nil || !strings.Contains(d.Error, "redirect") {
		t.Errorf("redirect delivery %+v", d)
	}
	r.status = []int{410}
	out, _ = f.svc.translate(context.Background(), message(f.channel, f.space, "gone"))
	f.enqueue(t, out)
	f.drain(t)
	got410, err := f.svc.outgoingHook(context.Background(), hook.Id)
	if err != nil || got410.DisabledAt == nil || !strings.Contains(got410.DisabledReason, "410") {
		t.Errorf("hook after 410: %+v %v", got410, err)
	}
	out, _ = f.svc.translate(context.Background(), message(f.channel, f.space, "to a disabled hook"))
	f.enqueue(t, out)
	f.drain(t)
	if _, err := f.svc.TestWebhook(f.admin, connect.NewRequest(&integrationsv1.TestWebhookRequest{Id: hook.Id})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("test on a disabled hook: %v", err)
	}
}

func TestOutgoingTargetsAndAuthorisation(t *testing.T) {
	f, r := outgoingFixture(t)
	f.policy.private = false
	for _, bad := range []string{"ftp://example.com/x", "https://user:pw@example.com/x", "not a url", "http://169.254.169.254/latest"} {
		if _, err := f.svc.CreateOutgoing(f.admin, connect.NewRequest(&integrationsv1.CreateOutgoingRequest{SpaceId: f.space, Name: "x", Url: bad, EventTypes: []string{EventMessageCreated}})); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	if _, err := f.svc.CreateOutgoing(f.admin, connect.NewRequest(&integrationsv1.CreateOutgoingRequest{SpaceId: f.space, Name: "x", Url: r.srv.URL, EventTypes: []string{EventMessageCreated}})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("a loopback target under the default policy: %v", err)
	}
	if _, err := f.svc.CreateOutgoing(f.admin, connect.NewRequest(&integrationsv1.CreateOutgoingRequest{SpaceId: f.space, Name: "x", Url: "https://example.com/hook", EventTypes: []string{"typing"}})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("unknown event type: %v", err)
	}
	if _, err := f.svc.CreateOutgoing(f.member, connect.NewRequest(&integrationsv1.CreateOutgoingRequest{SpaceId: f.space, Name: "x", Url: "https://example.com/hook", EventTypes: []string{EventMessageCreated}})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member created an outgoing hook: %v", err)
	}
	f.policy.private = true
	hook, secret := f.createOutgoing(t, r.srv.URL+"/hook", []string{EventMessageCreated}, "")

	// Flipping the policy off afterwards disables at delivery time with a reason.
	f.policy.private = false
	out, _ := f.svc.translate(context.Background(), message(f.channel, f.space, "now refused"))
	f.enqueue(t, out)
	f.drain(t)
	if len(r.deliveries()) != 0 {
		t.Error("a private target was reached under the default policy")
	}
	got, _ := f.svc.outgoingHook(context.Background(), hook.Id)
	if got.DisabledAt == nil || !strings.Contains(got.DisabledReason, "egress") {
		t.Errorf("hook after a refused dial: %+v", got)
	}
	f.policy.private = true

	// The outgoing switch stops queueing, delivering and testing; queued
	// items wait for it to come back.
	f.policy.outgoing = false
	f.enqueue(t, out)
	if _, err := f.svc.TestWebhook(f.admin, connect.NewRequest(&integrationsv1.TestWebhookRequest{Id: hook.Id})); connect.CodeOf(err) != connect.CodeUnavailable {
		t.Errorf("test with outgoing off: %v", err)
	}
	if _, err := f.pool.Exec(context.Background(), `INSERT INTO webhook_deliveries (id, lane, event_type, sequence, body, not_before, created_at) VALUES ($1, $2, 'message.created', 99, '{}', now(), now())`, newID(), hook.Id); err != nil {
		t.Fatal(err)
	}
	f.drain(t)
	if len(r.deliveries()) != 0 {
		t.Error("delivered with outgoing off")
	}
	f.policy.outgoing = true
	on := true
	if _, err := f.svc.UpdateOutgoing(f.admin, connect.NewRequest(&integrationsv1.UpdateOutgoingRequest{Id: hook.Id, Enabled: &on})); err != nil {
		t.Fatal(err)
	}
	f.drain(t)
	if len(r.deliveries()) != 1 {
		t.Errorf("queued item after outgoing came back: %d deliveries", len(r.deliveries()))
	}
	r.got = nil

	// Rotate replaces the secret; the old one no longer verifies.
	rot, err := f.svc.RotateSecret(f.admin, connect.NewRequest(&integrationsv1.RotateSecretRequest{Id: hook.Id}))
	if err != nil || rot.Msg.Secret == "" || rot.Msg.Secret == secret || rot.Msg.Url != "" {
		t.Fatalf("rotate: %v %+v", err, rot)
	}
	if _, err := f.svc.TestWebhook(f.admin, connect.NewRequest(&integrationsv1.TestWebhookRequest{Id: hook.Id})); err != nil {
		t.Fatal(err)
	}
	f.drain(t)
	got1 := r.deliveries()
	if len(got1) != 1 || got1[0].headers.Get("Stoop-Event") != EventWebhookTest {
		t.Fatalf("test delivery: %+v", got1)
	}
	verify(t, rot.Msg.Secret, got1[0])
	if _, err := f.svc.RotateSecret(f.member, connect.NewRequest(&integrationsv1.RotateSecretRequest{Id: hook.Id})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member rotated: %v", err)
	}
	if _, err := f.svc.ListDeliveries(f.member, connect.NewRequest(&integrationsv1.ListDeliveriesRequest{WebhookId: hook.Id})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member read the log: %v", err)
	}
	if _, err := f.svc.DeleteWebhook(f.admin, connect.NewRequest(&integrationsv1.DeleteWebhookRequest{Id: hook.Id})); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.outgoingHook(context.Background(), hook.Id); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("hook after delete: %v", err)
	}
}

func TestSubscriberFeedsTheQueueFromTheBus(t *testing.T) {
	f, r := outgoingFixture(t)
	f.createOutgoing(t, r.srv.URL+"/bus", []string{EventMessageCreated}, "")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go f.svc.RunSubscriber(ctx)
	go f.svc.RunWorker(ctx)
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && !f.svc.subs.has("space:"+f.space) {
		time.Sleep(10 * time.Millisecond)
	}
	f.svc.bus.Publish("space:"+f.space, message(f.channel, f.space, "over the bus"))
	for time.Now().Before(deadline) && len(r.deliveries()) == 0 {
		time.Sleep(20 * time.Millisecond)
	}
	got := r.deliveries()
	if len(got) != 1 || !strings.Contains(string(got[0].body), "over the bus") {
		t.Fatalf("bus delivery: %+v", got)
	}
}

func (s *subscriber) has(topic string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sub != nil && s.sub.Has(topic)
}
