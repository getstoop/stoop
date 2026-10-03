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
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	integrationsv1 "github.com/getstoop/stoop/gen/stoop/integrations/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/rowid"
)

// testMaxAttempts is the kind's limit as internal/app registers it.
const testMaxAttempts = 4

// receiver is an httptest endpoint that records every delivery and
// answers with a scripted status.
type receiver struct {
	srv    *httptest.Server
	mu     sync.Mutex
	got    []delivery
	status []int
	// retryAfter is the Retry-After header a 429 carries, in seconds.
	retryAfter string
}

type delivery struct {
	headers http.Header
	body    []byte
}

func newReceiver(t *testing.T) *receiver {
	t.Helper()
	endpoint := &receiver{retryAfter: "1"}
	endpoint.srv = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, req *http.Request) {
		body, _ := io.ReadAll(req.Body)
		endpoint.mu.Lock()
		endpoint.got = append(endpoint.got, delivery{headers: req.Header.Clone(), body: body})
		status := http.StatusOK
		if len(endpoint.status) > 0 {
			status, endpoint.status = endpoint.status[0], endpoint.status[1:]
		}
		retryAfter := endpoint.retryAfter
		endpoint.mu.Unlock()
		if status == http.StatusTooManyRequests {
			writer.Header().Set("Retry-After", retryAfter)
		}
		if status >= 300 && status < 400 {
			writer.Header().Set("Location", "http://169.254.169.254/latest/meta-data/")
		}
		writer.WriteHeader(status)
	}))
	t.Cleanup(endpoint.srv.Close)
	return endpoint
}

func (endpoint *receiver) deliveries() []delivery {
	endpoint.mu.Lock()
	defer endpoint.mu.Unlock()
	return append([]delivery(nil), endpoint.got...)
}

func (endpoint *receiver) last() delivery {
	got := endpoint.deliveries()
	return got[len(got)-1]
}

// queuedJob is one call the fake port recorded.
type queuedJob struct {
	kind     string
	args     DeliveryArgs
	lane     string
	sequence int64
}

// fakeJobs is the Jobs port in memory: what was queued, in order, and
// which lanes were discarded. Args go through JSON as the dispatcher's do.
type fakeJobs struct {
	mu        sync.Mutex
	queued    []queuedJob
	discarded []string
}

func (jobs *fakeJobs) EnqueueInLane(_ context.Context, kind string, args any, lane string, sequence int64) (string, error) {
	encoded, err := json.Marshal(args)
	if err != nil {
		return "", err
	}
	var decoded DeliveryArgs
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		return "", err
	}
	jobs.mu.Lock()
	defer jobs.mu.Unlock()
	jobs.queued = append(jobs.queued, queuedJob{kind: kind, args: decoded, lane: lane, sequence: sequence})
	return rowid.New(), nil
}

func (jobs *fakeJobs) DiscardLane(_ context.Context, lane, _ string) (int64, error) {
	jobs.mu.Lock()
	defer jobs.mu.Unlock()
	var kept []queuedJob
	var dropped int64
	for _, job := range jobs.queued {
		if job.lane == lane {
			dropped++
			continue
		}
		kept = append(kept, job)
	}
	jobs.queued = kept
	jobs.discarded = append(jobs.discarded, lane)
	return dropped, nil
}

func (jobs *fakeJobs) pending() int {
	jobs.mu.Lock()
	defer jobs.mu.Unlock()
	return len(jobs.queued)
}

// pop takes the oldest queued job.
func (jobs *fakeJobs) pop(t *testing.T) queuedJob {
	t.Helper()
	jobs.mu.Lock()
	defer jobs.mu.Unlock()
	if len(jobs.queued) == 0 {
		t.Fatal("nothing queued")
	}
	job := jobs.queued[0]
	jobs.queued = jobs.queued[1:]
	if job.kind != DeliverWebhookKind || job.lane != job.args.HookID || job.sequence != job.args.Sequence {
		t.Fatalf("queued job %+v", job)
	}
	return job
}

// outgoingFixture is the incoming fixture plus the fake port and a
// receiver, with private targets allowed so the receiver is reachable.
func outgoingFixture(t *testing.T) (*fixture, *receiver) {
	t.Helper()
	f := setup(t)
	f.policy.private = true
	f.jobs = &fakeJobs{}
	f.svc.UseJobs(f.jobs)
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

// enqueueMessage queues a message.created for the fixture's channel.
func (f *fixture) enqueueMessage(t *testing.T, content string) {
	t.Helper()
	out, ok := f.svc.translate(context.Background(), message(f.channel, f.space, content))
	if !ok {
		t.Fatal("message not translated")
	}
	f.enqueue(t, out)
}

// deliver performs one job once, as attempt of the kind's limit.
func (f *fixture) deliver(t *testing.T, job queuedJob, attempt int) DeliveryResult {
	t.Helper()
	res, err := f.svc.DeliverWebhook(context.Background(), job.args, attempt, testMaxAttempts)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

// drain performs every queued delivery to its end, retrying as the
// dispatcher would without its waits, and returns the final verdicts.
func (f *fixture) drain(t *testing.T) []DeliveryResult {
	t.Helper()
	var results []DeliveryResult
	for f.jobs.pending() > 0 {
		job := f.jobs.pop(t)
		for attempt := 1; attempt <= testMaxAttempts; attempt++ {
			res := f.deliver(t, job, attempt)
			if res.Delivered || res.Dead {
				results = append(results, res)
				break
			}
		}
	}
	return results
}

func (f *fixture) listDeliveries(t *testing.T, hookID string) []*integrationsv1.Delivery {
	t.Helper()
	log, err := f.svc.ListDeliveries(f.admin, connect.NewRequest(&integrationsv1.ListDeliveriesRequest{WebhookId: hookID}))
	if err != nil {
		t.Fatal(err)
	}
	return log.Msg.Deliveries
}

func (f *fixture) bodyKept(t *testing.T, deliveryID string) bool {
	t.Helper()
	var kept bool
	if err := f.pool.QueryRow(context.Background(), `SELECT body IS NOT NULL FROM webhook_deliveries WHERE id = $1`, deliveryID).Scan(&kept); err != nil {
		t.Fatal(err)
	}
	return kept
}

func (f *fixture) hook(t *testing.T, id string) (disabled bool, reason string) {
	t.Helper()
	hook, err := f.svc.outgoingHook(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return hook.DisabledAt != nil, hook.DisabledReason
}

func message(channelID, spaceID, content string) *realtimev1.ServerEvent {
	return events.Stamp(&realtimev1.ServerEvent{Payload: &realtimev1.ServerEvent_MessageCreated{
		MessageCreated: &chatv1.Message{Id: uuid.NewString(), ChannelId: channelID, SpaceId: spaceID, Content: content},
	}})
}

func verify(t *testing.T, secret string, got delivery) map[string]any {
	t.Helper()
	sig := got.headers.Get("Stoop-Signature")
	stamp, mac1, ok := strings.Cut(sig, ",")
	if !ok || !strings.HasPrefix(stamp, "t=") || !strings.HasPrefix(mac1, "v1=") {
		t.Fatalf("signature %q", sig)
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strings.TrimPrefix(stamp, "t=") + "."))
	mac.Write(got.body)
	if hex.EncodeToString(mac.Sum(nil)) != strings.TrimPrefix(mac1, "v1=") {
		t.Fatalf("signature does not verify: %q over %s", sig, got.body)
	}
	if at, _ := strconv.ParseInt(strings.TrimPrefix(stamp, "t="), 10, 64); time.Since(time.Unix(at, 0)) > time.Minute {
		t.Errorf("stale timestamp %s", stamp)
	}
	var env map[string]any
	if err := json.Unmarshal(got.body, &env); err != nil {
		t.Fatal(err)
	}
	return env
}

func TestOutgoingDeliversSignedEvents(t *testing.T) {
	f, endpoint := outgoingFixture(t)
	hook, secret := f.createOutgoing(t, endpoint.srv.URL+"/hook", []string{EventMessageCreated, EventMemberJoined}, "")
	if !strings.HasPrefix(secret, "stp_whsec_") || hook.Hint != "" || hook.Sequence != 0 {
		t.Fatalf("created %+v secret %q", hook, secret)
	}

	f.enqueueMessage(t, "hello receiver")
	if results := f.drain(t); len(results) != 1 || !results[0].Delivered {
		t.Fatalf("results = %+v", results)
	}
	got := endpoint.deliveries()
	if len(got) != 1 {
		t.Fatalf("deliveries = %d", len(got))
	}
	first := got[0]
	env := verify(t, secret, first)
	if first.headers.Get("Stoop-Event") != EventMessageCreated || first.headers.Get("Stoop-Sequence") != "1" || first.headers.Get("Stoop-Attempt") != "1" ||
		first.headers.Get("Stoop-Delivery") != env["id"] || first.headers.Get("Content-Type") != "application/json" || !strings.HasPrefix(first.headers.Get("User-Agent"), "Stoop/") {
		t.Errorf("headers %v", first.headers)
	}
	if env["type"] != EventMessageCreated || env["instance"] != "https://stoop.example.com" || env["space"].(map[string]any)["name"] != "Porch" ||
		env["data"].(map[string]any)["content"] != "hello receiver" {
		t.Errorf("envelope %s", first.body)
	}
	// The log: finished, 2xx, body cleared.
	logged := f.listDeliveries(t, hook.Id)
	if len(logged) != 1 || logged[0].Attempts != 1 || logged[0].GetStatusCode() != 200 || logged[0].FinishedAt == nil || logged[0].Error != "" {
		t.Errorf("log after success: %+v", logged)
	}
	if f.bodyKept(t, logged[0].Id) {
		t.Error("a delivered body was kept")
	}

	// An unsubscribed event type and a channel-filtered hook queue nothing.
	f.enqueue(t, outgoingEvent{Type: EventChannelDeleted, SpaceID: f.space, ChannelID: f.channel, Data: rawJSON(map[string]string{})})
	if f.jobs.pending() != 0 {
		t.Error("an unwanted event type was queued")
	}
	other := uuid.NewString()
	if _, err := f.pool.Exec(context.Background(), `INSERT INTO channels (id, space_id, name, position) VALUES ($1, $2, 'other', 1)`, other, f.space); err != nil {
		t.Fatal(err)
	}
	f.spaces.channel[other] = f.space
	filtered, _ := f.createOutgoing(t, endpoint.srv.URL+"/filtered", []string{EventMessageCreated, EventMemberJoined}, other)
	f.enqueueMessage(t, "not for the filtered hook")
	joined, _ := f.svc.translate(context.Background(), events.Stamp(&realtimev1.ServerEvent{Payload: &realtimev1.ServerEvent_MemberJoined{
		MemberJoined: &realtimev1.MemberJoined{SpaceId: f.space, UserId: uuid.NewString()},
	}}))
	f.enqueue(t, joined)
	f.drain(t)
	byEvent := map[string]int{}
	for _, got := range endpoint.deliveries() {
		byEvent[got.headers.Get("Stoop-Event")]++
	}
	if byEvent[EventMessageCreated] != 2 || byEvent[EventMemberJoined] != 2 {
		t.Errorf("filtered hook got the wrong events: %v", byEvent)
	}
	if logged := f.listDeliveries(t, filtered.Id); len(logged) != 1 || logged[0].EventType != EventMemberJoined {
		t.Errorf("filtered hook's log: %+v", logged)
	}

	// Members see the hook without its secret; the DM topic never reaches it.
	list, err := f.svc.ListWebhooks(f.member, connect.NewRequest(&integrationsv1.ListWebhooksRequest{SpaceId: f.space}))
	if err != nil || len(list.Msg.Outgoing) != 2 {
		t.Fatalf("member list: %v %+v", err, list)
	}
	if strings.Contains(list.Msg.String(), "stp_whsec_") {
		t.Error("a listing carried a signing secret")
	}
	if list.Msg.Outgoing[0].Url != endpoint.srv.URL {
		t.Errorf("a member saw more than the target host: %q", list.Msg.Outgoing[0].Url)
	}
	if full, _ := f.svc.ListWebhooks(f.admin, connect.NewRequest(&integrationsv1.ListWebhooksRequest{SpaceId: f.space})); full.Msg.Outgoing[0].Url != endpoint.srv.URL+"/hook" {
		t.Errorf("the admin saw %q", full.Msg.Outgoing[0].Url)
	}
	if all, _ := f.svc.ListWebhooks(f.admin, connect.NewRequest(&integrationsv1.ListWebhooksRequest{})); all.Msg.Outgoing[0].SpaceName != "Porch" {
		t.Errorf("the server-wide list lacks space names: %+v", all.Msg)
	}
	if _, ok := f.svc.translate(context.Background(), message("dm-channel", "", "private")); ok {
		t.Error("a direct message was translated for hooks")
	}
}

func TestOutgoingRetriesAndDeadLetters(t *testing.T) {
	f, endpoint := outgoingFixture(t)
	hook, secret := f.createOutgoing(t, endpoint.srv.URL+"/flaky", []string{EventMessageCreated}, "")
	endpoint.status = []int{500, 503, 200}
	f.enqueueMessage(t, "retry me")
	job := f.jobs.pop(t)
	for attempt := 1; attempt <= 2; attempt++ {
		if res := f.deliver(t, job, attempt); res.Delivered || res.Dead || res.RetryAfter != 0 || !strings.Contains(res.Error, "HTTP 50") {
			t.Errorf("attempt %d = %+v, want a retry on the ladder", attempt, res)
		}
	}
	if res := f.deliver(t, job, 3); !res.Delivered {
		t.Errorf("attempt 3 = %+v", res)
	}
	got := endpoint.deliveries()
	if len(got) != 3 {
		t.Fatalf("attempts = %d", len(got))
	}
	for index, tried := range got {
		if tried.headers.Get("Stoop-Delivery") != got[0].headers.Get("Stoop-Delivery") || tried.headers.Get("Stoop-Attempt") != strconv.Itoa(index+1) {
			t.Errorf("attempt %d headers %v", index+1, tried.headers)
		}
		verify(t, secret, tried)
	}
	logged := f.listDeliveries(t, hook.Id)
	if len(logged) != 1 || logged[0].Attempts != 3 || logged[0].GetStatusCode() != 200 || logged[0].FinishedAt == nil {
		t.Errorf("log after retries: %+v", logged)
	}

	// Four failures: dead, body kept, redeliverable; a jump in sequence.
	endpoint.status = []int{500, 500, 500, 500}
	f.enqueueMessage(t, "doomed")
	if results := f.drain(t); len(results) != 1 || !results[0].Dead {
		t.Errorf("results = %+v", results)
	}
	if len(endpoint.deliveries()) != 7 {
		t.Fatalf("attempts after a dead delivery = %d", len(endpoint.deliveries()))
	}
	logged = f.listDeliveries(t, hook.Id)
	dead := logged[0]
	if dead.Attempts != 4 || dead.FinishedAt == nil || dead.GetStatusCode() != 500 || dead.Sequence != 2 {
		t.Errorf("dead delivery %+v", dead)
	}
	if !f.bodyKept(t, dead.Id) {
		t.Error("a dead delivery lost its body")
	}
	if _, err := f.svc.RedeliverDelivery(f.admin, connect.NewRequest(&integrationsv1.RedeliverDeliveryRequest{DeliveryId: logged[1].Id})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("redelivering a success: %v", err)
	}
	again, err := f.svc.RedeliverDelivery(f.admin, connect.NewRequest(&integrationsv1.RedeliverDeliveryRequest{DeliveryId: dead.Id}))
	if err != nil {
		t.Fatal(err)
	}
	if again.Msg.Delivery.Id == dead.Id || again.Msg.Delivery.Attempts != 0 || again.Msg.Delivery.FinishedAt != nil || again.Msg.Delivery.Sequence != 2 {
		t.Errorf("redelivery row %+v", again.Msg.Delivery)
	}
	f.drain(t)
	last := endpoint.last()
	if last.headers.Get("Stoop-Delivery") != again.Msg.Delivery.Id || last.headers.Get("Stoop-Sequence") != "2" {
		t.Errorf("redelivery headers %v", last.headers)
	}
	f.enqueueMessage(t, "after the gap")
	f.drain(t)
	if seq := endpoint.last().headers.Get("Stoop-Sequence"); seq != "3" {
		t.Errorf("sequence after a dead delivery = %s", seq)
	}

	// 429 waits Retry-After, bounded by what the ladder would still take.
	endpoint.status = []int{429, 429, 429, 200}
	f.enqueueMessage(t, "throttled")
	job = f.jobs.pop(t)
	if res := f.deliver(t, job, 1); res.Dead || res.Delivered || res.RetryAfter != time.Second {
		t.Errorf("429 with Retry-After: 1 = %+v", res)
	}
	endpoint.retryAfter = "3600"
	if res := f.deliver(t, job, 2); res.RetryAfter != 30*time.Second+2*time.Minute {
		t.Errorf("a long Retry-After on attempt 2 = %+v, want the ladder's remainder", res)
	}
	if res := f.deliver(t, job, 3); res.RetryAfter != 2*time.Minute {
		t.Errorf("a long Retry-After on attempt 3 = %+v, want the ladder's last step", res)
	}
	if res := f.deliver(t, job, 4); !res.Delivered {
		t.Errorf("attempt 4 = %+v", res)
	}

	// 3xx is a failure, never followed; the dead row keeps its error.
	endpoint.status = []int{302, 302, 302, 302}
	f.enqueueMessage(t, "redirected")
	f.drain(t)
	if row := f.listDeliveries(t, hook.Id)[0]; row.GetStatusCode() != 302 || row.FinishedAt == nil || !strings.Contains(row.Error, "redirect") {
		t.Errorf("redirect delivery %+v", row)
	}

	// 410 disables.
	endpoint.status = []int{410}
	f.enqueueMessage(t, "gone")
	if results := f.drain(t); len(results) != 1 || !results[0].Dead {
		t.Errorf("results after 410 = %+v", results)
	}
	if disabled, reason := f.hook(t, hook.Id); !disabled || !strings.Contains(reason, "410") {
		t.Errorf("hook after 410: %v %q", disabled, reason)
	}
	// A delivery already queued for a disabled hook is dead on arrival.
	if _, err := f.pool.Exec(context.Background(), `UPDATE outgoing_webhooks SET disabled_at = NULL WHERE id = $1`, hook.Id); err != nil {
		t.Fatal(err)
	}
	f.enqueueMessage(t, "to a disabled hook")
	if err := f.svc.disableOutgoing(context.Background(), hook.Id, "turned off by an admin"); err != nil {
		t.Fatal(err)
	}
	if results := f.drain(t); len(results) != 1 || !results[0].Dead || results[0].Error != "webhook is disabled" {
		t.Errorf("results for a disabled hook = %+v", results)
	}
	if _, err := f.svc.TestWebhook(f.admin, connect.NewRequest(&integrationsv1.TestWebhookRequest{Id: hook.Id})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("test on a disabled hook: %v", err)
	}
}

func TestOutgoingTargetsAndAuthorisation(t *testing.T) {
	f, endpoint := outgoingFixture(t)
	f.policy.private = false
	for _, bad := range []string{"ftp://example.com/x", "https://user:pw@example.com/x", "not a url", "http://169.254.169.254/latest"} {
		if _, err := f.svc.CreateOutgoing(f.admin, connect.NewRequest(&integrationsv1.CreateOutgoingRequest{SpaceId: f.space, Name: "x", Url: bad, EventTypes: []string{EventMessageCreated}})); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	if _, err := f.svc.CreateOutgoing(f.admin, connect.NewRequest(&integrationsv1.CreateOutgoingRequest{SpaceId: f.space, Name: "x", Url: endpoint.srv.URL, EventTypes: []string{EventMessageCreated}})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("a loopback target under the default policy: %v", err)
	}
	if _, err := f.svc.CreateOutgoing(f.admin, connect.NewRequest(&integrationsv1.CreateOutgoingRequest{SpaceId: f.space, Name: "x", Url: "https://example.com/hook", EventTypes: []string{"typing"}})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("unknown event type: %v", err)
	}
	if _, err := f.svc.CreateOutgoing(f.member, connect.NewRequest(&integrationsv1.CreateOutgoingRequest{SpaceId: f.space, Name: "x", Url: "https://example.com/hook", EventTypes: []string{EventMessageCreated}})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member created an outgoing hook: %v", err)
	}
	f.policy.private = true
	hook, secret := f.createOutgoing(t, endpoint.srv.URL+"/hook", []string{EventMessageCreated}, "")

	// Flipping the policy off afterwards disables at delivery time with a
	// reason; the next attempt finds the hook disabled.
	f.policy.private = false
	f.enqueueMessage(t, "now refused")
	job := f.jobs.pop(t)
	if res := f.deliver(t, job, 1); res.Dead || res.Delivered {
		t.Errorf("a refused dial = %+v", res)
	}
	if len(endpoint.deliveries()) != 0 {
		t.Error("a private target was reached under the default policy")
	}
	if disabled, reason := f.hook(t, hook.Id); !disabled || !strings.Contains(reason, "egress") {
		t.Errorf("hook after a refused dial: %v %q", disabled, reason)
	}
	if res := f.deliver(t, job, 2); !res.Dead || res.Error != "webhook is disabled" {
		t.Errorf("the attempt after = %+v", res)
	}
	f.policy.private = true
	on := true
	if _, err := f.svc.UpdateOutgoing(f.admin, connect.NewRequest(&integrationsv1.UpdateOutgoingRequest{Id: hook.Id, Enabled: &on})); err != nil {
		t.Fatal(err)
	}

	// The outgoing switch stops queueing and testing; a delivery queued
	// before it flipped is dead with the reason, body kept for later.
	f.enqueueMessage(t, "queued before the switch")
	f.policy.outgoing = false
	f.enqueueMessage(t, "while off")
	if f.jobs.pending() != 1 {
		t.Errorf("queued with outgoing off: %d jobs", f.jobs.pending())
	}
	if _, err := f.svc.TestWebhook(f.admin, connect.NewRequest(&integrationsv1.TestWebhookRequest{Id: hook.Id})); connect.CodeOf(err) != connect.CodeUnavailable {
		t.Errorf("test with outgoing off: %v", err)
	}
	if results := f.drain(t); len(results) != 1 || !results[0].Dead || results[0].Error != reasonOff {
		t.Errorf("results with outgoing off = %+v", results)
	}
	if len(endpoint.deliveries()) != 0 {
		t.Error("delivered with outgoing off")
	}
	offRow := f.listDeliveries(t, hook.Id)[0]
	if offRow.FinishedAt == nil || offRow.Error != reasonOff || !f.bodyKept(t, offRow.Id) {
		t.Errorf("the log row with outgoing off: %+v", offRow)
	}
	f.policy.outgoing = true
	if _, err := f.svc.RedeliverDelivery(f.admin, connect.NewRequest(&integrationsv1.RedeliverDeliveryRequest{DeliveryId: offRow.Id})); err != nil {
		t.Fatal(err)
	}
	f.drain(t)
	if len(endpoint.deliveries()) != 1 {
		t.Errorf("sent again after outgoing came back: %d deliveries", len(endpoint.deliveries()))
	}
	endpoint.got = nil

	// Rotate replaces the secret; the old one no longer verifies.
	rot, err := f.svc.RotateSecret(f.admin, connect.NewRequest(&integrationsv1.RotateSecretRequest{Id: hook.Id}))
	if err != nil || rot.Msg.Secret == "" || rot.Msg.Secret == secret || rot.Msg.Url != "" {
		t.Fatalf("rotate: %v %+v", err, rot)
	}
	if _, err := f.svc.TestWebhook(f.admin, connect.NewRequest(&integrationsv1.TestWebhookRequest{Id: hook.Id})); err != nil {
		t.Fatal(err)
	}
	f.drain(t)
	tested := endpoint.deliveries()
	if len(tested) != 1 || tested[0].headers.Get("Stoop-Event") != EventWebhookTest {
		t.Fatalf("test delivery: %+v", tested)
	}
	verify(t, rot.Msg.Secret, tested[0])
	if _, err := f.svc.RotateSecret(f.member, connect.NewRequest(&integrationsv1.RotateSecretRequest{Id: hook.Id})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member rotated: %v", err)
	}
	if _, err := f.svc.ListDeliveries(f.member, connect.NewRequest(&integrationsv1.ListDeliveriesRequest{WebhookId: hook.Id})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member read the log: %v", err)
	}

	// Deleting the hook discards its lane; the log rows cascade.
	f.enqueueMessage(t, "never sent")
	if _, err := f.svc.DeleteWebhook(f.admin, connect.NewRequest(&integrationsv1.DeleteWebhookRequest{Id: hook.Id})); err != nil {
		t.Fatal(err)
	}
	if len(f.jobs.discarded) != 1 || f.jobs.discarded[0] != hook.Id || f.jobs.pending() != 0 {
		t.Errorf("after delete: discarded %v, %d queued", f.jobs.discarded, f.jobs.pending())
	}
	if _, err := f.svc.outgoingHook(context.Background(), hook.Id); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("hook after delete: %v", err)
	}
	if _, err := f.svc.ListDeliveries(f.admin, connect.NewRequest(&integrationsv1.ListDeliveriesRequest{WebhookId: hook.Id})); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("log after delete: %v", err)
	}
}

func TestOutgoingTwentyDeadInARowDisable(t *testing.T) {
	f, endpoint := outgoingFixture(t)
	hook, _ := f.createOutgoing(t, endpoint.srv.URL+"/down", []string{EventMessageCreated}, "")
	for range deadToDisable * testMaxAttempts {
		endpoint.status = append(endpoint.status, 503)
	}
	for index := range deadToDisable - 1 {
		f.enqueueMessage(t, "down "+strconv.Itoa(index))
	}
	f.drain(t)
	if disabled, _ := f.hook(t, hook.Id); disabled {
		t.Fatal("disabled before the twentieth dead delivery")
	}
	f.enqueueMessage(t, "the twentieth")
	f.drain(t)
	if disabled, reason := f.hook(t, hook.Id); !disabled || !strings.Contains(reason, "20 deliveries in a row") {
		t.Errorf("hook after twenty dead: %v %q", disabled, reason)
	}
}

func TestSubscriberQueuesDeliveriesFromTheBus(t *testing.T) {
	f, endpoint := outgoingFixture(t)
	f.createOutgoing(t, endpoint.srv.URL+"/bus", []string{EventMessageCreated}, "")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go f.svc.RunSubscriber(ctx)
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && !f.svc.subs.has("space:"+f.space) {
		time.Sleep(10 * time.Millisecond)
	}
	f.svc.bus.Publish("space:"+f.space, message(f.channel, f.space, "over the bus"))
	for time.Now().Before(deadline) && f.jobs.pending() == 0 {
		time.Sleep(20 * time.Millisecond)
	}
	if f.jobs.pending() != 1 {
		t.Fatal("the bus event was not queued")
	}
	job := f.jobs.pop(t)
	if !strings.Contains(string(job.args.Body), "over the bus") || job.args.Event != EventMessageCreated {
		t.Fatalf("queued job: %+v", job)
	}
	if res := f.deliver(t, job, 1); !res.Delivered {
		t.Errorf("bus delivery: %+v", res)
	}
}

func (s *subscriber) has(topic string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sub != nil && s.sub.Has(topic)
}

func TestOutgoingRecordsAnyReply(t *testing.T) {
	replies := map[string]string{
		"binary":   "\xff\xfe\x80 not text",
		"nul":      "ok\x00ok",
		"straddle": strings.Repeat("a", responseKeep-1) + "é",
	}
	for name, reply := range replies {
		t.Run(name, func(t *testing.T) {
			f, _ := outgoingFixture(t)
			srv := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				_, _ = io.WriteString(writer, reply)
			}))
			t.Cleanup(srv.Close)
			hook, _ := f.createOutgoing(t, srv.URL, []string{EventMessageCreated}, "")
			f.enqueueMessage(t, "hello")
			if results := f.drain(t); len(results) != 1 || !results[0].Delivered {
				t.Fatalf("results = %+v", results)
			}
			if logged := f.listDeliveries(t, hook.Id); len(logged) != 1 || logged[0].FinishedAt == nil || logged[0].GetStatusCode() != 200 || !utf8.ValidString(logged[0].Response) {
				t.Errorf("log: %+v", logged)
			}
		})
	}
}

func TestCutBytesKeepsWholeCharacters(t *testing.T) {
	got := cutBytes("aé", 2)
	if got != "a" || !utf8.ValidString(got) {
		t.Errorf("cutBytes = %q", got)
	}
}

func TestDeliverWebhookWithoutAHook(t *testing.T) {
	f, _ := outgoingFixture(t)
	args := DeliveryArgs{DeliveryID: rowid.New(), HookID: uuid.NewString(), Event: EventWebhookTest, Sequence: 1, Body: []byte("{}")}

	// A query that fails is the module's error, for the dispatcher to retry.
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if res, err := f.svc.DeliverWebhook(cancelled, args, 1, testMaxAttempts); err == nil || res != (DeliveryResult{}) {
		t.Errorf("a failed lookup = %+v, %v", res, err)
	}

	// A hook that is gone is dead, not an error.
	if res, err := f.svc.DeliverWebhook(context.Background(), args, 1, testMaxAttempts); err != nil || !res.Dead || res.Error != "webhook is gone" {
		t.Errorf("a missing hook = %+v, %v", res, err)
	}
}

func TestDeleteWebhookWithAMalformedIDIsNotFound(t *testing.T) {
	f, _ := outgoingFixture(t)
	_, err := f.svc.DeleteWebhook(f.admin, connect.NewRequest(&integrationsv1.DeleteWebhookRequest{Id: "nope"}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("delete nope: %v", err)
	}
}

func TestTestWebhookReturnsTheTestDelivery(t *testing.T) {
	f, endpoint := outgoingFixture(t)
	hook, _ := f.createOutgoing(t, endpoint.srv.URL, []string{EventMessageCreated}, "")
	f.enqueueMessage(t, "earlier")
	res, err := f.svc.TestWebhook(f.admin, connect.NewRequest(&integrationsv1.TestWebhookRequest{Id: hook.Id}))
	if err != nil {
		t.Fatal(err)
	}
	if row := res.Msg.Delivery; row.EventType != EventWebhookTest || row.Attempts != 0 || row.FinishedAt != nil || row.Sequence != 2 {
		t.Errorf("test delivery = %+v", row)
	}
	if f.jobs.pending() != 2 {
		t.Errorf("%d queued, want the message and the test", f.jobs.pending())
	}
}

func TestDeliveriesRefusedUntilWired(t *testing.T) {
	f := setup(t)
	f.policy.private = true
	endpoint := newReceiver(t)
	hook, _ := f.createOutgoing(t, endpoint.srv.URL, []string{EventMessageCreated}, "")
	if _, err := f.svc.TestWebhook(f.admin, connect.NewRequest(&integrationsv1.TestWebhookRequest{Id: hook.Id})); connect.CodeOf(err) != connect.CodeUnavailable {
		t.Errorf("test without the port: %v", err)
	}
	if _, err := f.svc.RedeliverDelivery(f.admin, connect.NewRequest(&integrationsv1.RedeliverDeliveryRequest{DeliveryId: rowid.New()})); connect.CodeOf(err) != connect.CodeUnavailable {
		t.Errorf("redeliver without the port: %v", err)
	}
	out, _ := f.svc.translate(context.Background(), message(f.channel, f.space, "nowhere to go"))
	if err := f.svc.enqueue(context.Background(), out); err != nil {
		t.Fatal(err)
	}
	if logged := f.listDeliveries(t, hook.Id); len(logged) != 0 {
		t.Errorf("queued without the port: %+v", logged)
	}
}
