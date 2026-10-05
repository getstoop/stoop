package integrations

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
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
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	integrationsv1 "github.com/getstoop/stoop/gen/stoop/integrations/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/apierr/apierrtest"
	"github.com/getstoop/stoop/internal/dbgen"
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

// queuedJob is one call the fake port recorded: a delivery's args, or a
// fan-out's event.
type queuedJob struct {
	id       string
	kind     string
	args     DeliveryArgs
	event    OutgoingEvent
	lane     string
	sequence int64
	// inTx marks a job enqueued in a transaction; it counts once its row
	// in jobs is committed.
	inTx bool
}

// fakeJobs is the Jobs port in memory: what was queued, in order, and
// which lanes were discarded. Args go through JSON as the dispatcher's do.
// A job enqueued in a transaction also writes a jobs row there, so a
// rollback takes it back.
type fakeJobs struct {
	pool      *pgxpool.Pool
	mu        sync.Mutex
	queued    []queuedJob
	discarded []string
	// refuse, when set, is what every enqueue fails with; with refuseLane
	// set too, only an enqueue into that lane.
	refuse     error
	refuseLane string
	// statuses is what JobStatuses answers, by id.
	statuses map[string]JobStatus
	// onEnqueueInTx, when set, runs after each enqueue in a transaction,
	// while that transaction is still open.
	onEnqueueInTx func(lane string)
}

func (jobs *fakeJobs) EnqueueInLane(_ context.Context, kind string, args any, lane string, sequence int64) (string, error) {
	job, err := jobs.record(kind, args, lane, sequence)
	if err != nil {
		return "", err
	}
	jobs.add(job)
	return job.id, nil
}

func (jobs *fakeJobs) EnqueueInLaneTx(ctx context.Context, tx pgx.Tx, kind string, args any, lane string, sequence int64) (string, error) {
	job, err := jobs.record(kind, args, lane, sequence)
	if err != nil {
		return "", err
	}
	job.inTx = true
	if err := dbgen.New(tx).InsertJob(ctx, dbgen.InsertJobParams{
		ID: job.id, Kind: kind, Args: []byte("{}"), Lane: &lane, Sequence: &sequence, MaxAttempts: testMaxAttempts, NotBefore: time.Now(), Now: time.Now(),
	}); err != nil {
		return "", err
	}
	jobs.add(job)
	if jobs.onEnqueueInTx != nil {
		jobs.onEnqueueInTx(lane)
	}
	return job.id, nil
}

// record decodes args by kind, or fails as refuse says.
func (jobs *fakeJobs) record(kind string, args any, lane string, sequence int64) (queuedJob, error) {
	if jobs.refuse != nil && (jobs.refuseLane == "" || jobs.refuseLane == lane) {
		return queuedJob{}, jobs.refuse
	}
	encoded, err := json.Marshal(args)
	if err != nil {
		return queuedJob{}, err
	}
	job := queuedJob{id: rowid.New(), kind: kind, lane: lane, sequence: sequence}
	if kind == FanOutWebhookEventKind {
		err = json.Unmarshal(encoded, &job.event)
	} else {
		err = json.Unmarshal(encoded, &job.args)
	}
	return job, err
}

func (jobs *fakeJobs) add(job queuedJob) {
	jobs.mu.Lock()
	defer jobs.mu.Unlock()
	jobs.queued = append(jobs.queued, job)
}

func (jobs *fakeJobs) JobStatuses(_ context.Context, ids []string) (map[string]JobStatus, error) {
	jobs.mu.Lock()
	defer jobs.mu.Unlock()
	found := map[string]JobStatus{}
	for _, id := range ids {
		if status, ok := jobs.statuses[id]; ok {
			found[id] = status
		}
	}
	return found, nil
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
	jobs.forgetRolledBack()
	jobs.mu.Lock()
	defer jobs.mu.Unlock()
	return len(jobs.queued)
}

// forgetRolledBack drops the jobs enqueued in a transaction that did not
// commit.
func (jobs *fakeJobs) forgetRolledBack() {
	jobs.mu.Lock()
	defer jobs.mu.Unlock()
	kept := jobs.queued[:0]
	for _, job := range jobs.queued {
		if job.inTx {
			var committed bool
			if err := jobs.pool.QueryRow(context.Background(), `SELECT EXISTS (SELECT 1 FROM jobs WHERE id = $1)`, job.id).Scan(&committed); err != nil || !committed {
				continue
			}
		}
		kept = append(kept, job)
	}
	jobs.queued = kept
}

// takeFanOuts removes the queued fan-out jobs, in order.
func (jobs *fakeJobs) takeFanOuts() []queuedJob {
	jobs.forgetRolledBack()
	jobs.mu.Lock()
	defer jobs.mu.Unlock()
	var fanOuts, rest []queuedJob
	for _, job := range jobs.queued {
		if job.kind == FanOutWebhookEventKind {
			fanOuts = append(fanOuts, job)
		} else {
			rest = append(rest, job)
		}
	}
	jobs.queued = rest
	return fanOuts
}

// pop takes the oldest queued delivery.
func (jobs *fakeJobs) pop(t *testing.T) queuedJob {
	t.Helper()
	jobs.forgetRolledBack()
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
	f.jobs = &fakeJobs{pool: f.pool}
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

// enqueue runs the event through the subscriber's enqueue and performs
// the fan-out it queued, as the dispatcher would.
func (f *fixture) enqueue(t *testing.T, ev OutgoingEvent) {
	t.Helper()
	if err := f.svc.enqueue(context.Background(), ev); err != nil {
		t.Fatal(err)
	}
	f.fanOut(t)
}

// fanOut performs every queued fan-out job once.
func (f *fixture) fanOut(t *testing.T) {
	t.Helper()
	for _, job := range f.jobs.takeFanOuts() {
		if job.lane != job.event.SpaceID {
			t.Fatalf("fan-out in lane %q for space %q", job.lane, job.event.SpaceID)
		}
		if err := f.svc.FanOutWebhookEvent(context.Background(), job.event); err != nil {
			t.Fatal(err)
		}
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
	f.enqueue(t, OutgoingEvent{Type: EventChannelDeleted, SpaceID: f.space, ChannelID: f.channel, Data: rawJSON(map[string]string{})})
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
	_, err := f.svc.RedeliverDelivery(f.admin, connect.NewRequest(&integrationsv1.RedeliverDeliveryRequest{DeliveryId: logged[1].Id}))
	apierrtest.ExpectCode(t, err, connect.CodeFailedPrecondition, "redelivering a success")
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
	_, err = f.svc.TestWebhook(f.admin, connect.NewRequest(&integrationsv1.TestWebhookRequest{Id: hook.Id}))
	apierrtest.ExpectCode(t, err, connect.CodeFailedPrecondition, "test on a disabled hook")
}

func TestOutgoingTargetsAndAuthorisation(t *testing.T) {
	f, endpoint := outgoingFixture(t)
	f.policy.private = false
	for _, bad := range []string{"ftp://example.com/x", "https://user:pw@example.com/x", "not a url", "http://169.254.169.254/latest"} {
		if _, err := f.svc.CreateOutgoing(f.admin, connect.NewRequest(&integrationsv1.CreateOutgoingRequest{SpaceId: f.space, Name: "x", Url: bad, EventTypes: []string{EventMessageCreated}})); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	_, err := f.svc.CreateOutgoing(f.admin, connect.NewRequest(&integrationsv1.CreateOutgoingRequest{SpaceId: f.space, Name: "x", Url: endpoint.srv.URL, EventTypes: []string{EventMessageCreated}}))
	apierrtest.ExpectCode(t, err, connect.CodeFailedPrecondition, "a loopback target under the default policy")
	_, err = f.svc.CreateOutgoing(f.admin, connect.NewRequest(&integrationsv1.CreateOutgoingRequest{SpaceId: f.space, Name: "x", Url: "https://example.com/hook", EventTypes: []string{"typing"}}))
	apierrtest.ExpectCode(t, err, connect.CodeInvalidArgument, "unknown event type")
	_, err = f.svc.CreateOutgoing(f.member, connect.NewRequest(&integrationsv1.CreateOutgoingRequest{SpaceId: f.space, Name: "x", Url: "https://example.com/hook", EventTypes: []string{EventMessageCreated}}))
	apierrtest.ExpectCode(t, err, connect.CodePermissionDenied, "a member created an outgoing hook")
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
	_, err = f.svc.TestWebhook(f.admin, connect.NewRequest(&integrationsv1.TestWebhookRequest{Id: hook.Id}))
	apierrtest.ExpectCode(t, err, connect.CodeUnavailable, "test with outgoing off")
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
	_, err = f.svc.RotateSecret(f.member, connect.NewRequest(&integrationsv1.RotateSecretRequest{Id: hook.Id}))
	apierrtest.ExpectCode(t, err, connect.CodePermissionDenied, "a member rotated")
	_, err = f.svc.ListDeliveries(f.member, connect.NewRequest(&integrationsv1.ListDeliveriesRequest{WebhookId: hook.Id}))
	apierrtest.ExpectCode(t, err, connect.CodePermissionDenied, "a member read the log")

	// Deleting the hook discards its lane; the log rows cascade.
	f.enqueueMessage(t, "never sent")
	if _, err := f.svc.DeleteWebhook(f.admin, connect.NewRequest(&integrationsv1.DeleteWebhookRequest{Id: hook.Id})); err != nil {
		t.Fatal(err)
	}
	if len(f.jobs.discarded) != 1 || f.jobs.discarded[0] != hook.Id || f.jobs.pending() != 0 {
		t.Errorf("after delete: discarded %v, %d queued", f.jobs.discarded, f.jobs.pending())
	}
	_, err = f.svc.outgoingHook(context.Background(), hook.Id)
	apierrtest.ExpectCode(t, err, connect.CodeNotFound, "hook after delete")
	_, err = f.svc.ListDeliveries(f.admin, connect.NewRequest(&integrationsv1.ListDeliveriesRequest{WebhookId: hook.Id}))
	apierrtest.ExpectCode(t, err, connect.CodeNotFound, "log after delete")
}

func TestOutgoingTwentyDeadInARowDisable(t *testing.T) {
	f, endpoint := outgoingFixture(t)
	hook, _ := f.createOutgoing(t, endpoint.srv.URL+"/down", []string{EventMessageCreated}, "")
	for range 2 * deadToDisable * testMaxAttempts {
		endpoint.status = append(endpoint.status, 503)
	}
	failTimes := func(count int, label string) {
		for index := range count {
			f.enqueueMessage(t, label+" "+strconv.Itoa(index))
		}
		f.drain(t)
	}
	failTimes(deadToDisable-1, "down")
	if disabled, _ := f.hook(t, hook.Id); disabled {
		t.Fatal("disabled before the twentieth dead delivery")
	}

	// A delivery the server's switch stopped is not the receiver's
	// failure: it neither counts nor continues the run.
	f.enqueueMessage(t, "stopped by the switch")
	f.policy.outgoing = false
	f.drain(t)
	f.policy.outgoing = true
	failTimes(1, "after the switch")
	if disabled, _ := f.hook(t, hook.Id); disabled {
		t.Fatal("disabled across a switch-off")
	}

	failTimes(deadToDisable-1, "down again")
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
	f.fanOut(t)
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

// Whatever the receiver answers is delivered and never stored.
func TestOutgoingKeepsNoReply(t *testing.T) {
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
			if logged := f.listDeliveries(t, hook.Id); len(logged) != 1 || logged[0].FinishedAt == nil || logged[0].GetStatusCode() != 200 || logged[0].GetResponse() != "" {
				t.Errorf("log: %+v", logged)
			}
			var stored string
			if err := f.pool.QueryRow(context.Background(),
				"SELECT response FROM webhook_deliveries WHERE webhook_id = $1", hook.Id).Scan(&stored); err != nil || stored != "" {
				t.Errorf("stored reply %q (%v), want none", stored, err)
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
	apierrtest.ExpectCode(t, err, connect.CodeNotFound, "delete nope")
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
	_, err := f.svc.TestWebhook(f.admin, connect.NewRequest(&integrationsv1.TestWebhookRequest{Id: hook.Id}))
	apierrtest.ExpectCode(t, err, connect.CodeUnavailable, "test without the port")
	_, err = f.svc.RedeliverDelivery(f.admin, connect.NewRequest(&integrationsv1.RedeliverDeliveryRequest{DeliveryId: rowid.New()}))
	apierrtest.ExpectCode(t, err, connect.CodeUnavailable, "redeliver without the port")
	out, _ := f.svc.translate(context.Background(), message(f.channel, f.space, "nowhere to go"))
	if err := f.svc.enqueue(context.Background(), out); err != nil {
		t.Fatal(err)
	}
	if logged := f.listDeliveries(t, hook.Id); len(logged) != 0 {
		t.Errorf("queued without the port: %+v", logged)
	}
}

// seedUnfinished inserts a pending log row made at when, with a job id
// when one is given.
func (f *fixture) seedUnfinished(t *testing.T, hookID string, sequence int64, when time.Time, jobID string) string {
	t.Helper()
	ctx := context.Background()
	id := rowid.New()
	if err := f.svc.q.InsertDelivery(ctx, dbgen.InsertDeliveryParams{
		ID: id, WebhookID: hookID, EventType: EventMessageCreated, Sequence: sequence, Body: []byte(`{"id":"` + id + `"}`), Now: when,
	}); err != nil {
		t.Fatal(err)
	}
	if jobID != "" {
		if err := f.svc.q.SetDeliveryJob(ctx, dbgen.SetDeliveryJobParams{ID: id, JobID: jobID}); err != nil {
			t.Fatal(err)
		}
	}
	return id
}

// A queued delivery records its job's id; the sweep finishes an old
// unfinished row whose job is discarded, gone or was never queued as
// dead with the reason, leaves a live or young one alone, and the dead
// row can be sent again.
func TestSweepLostDeliveries(t *testing.T) {
	f, endpoint := outgoingFixture(t)
	ctx := context.Background()
	clock := time.Now().Truncate(time.Microsecond)
	f.svc.now = func() time.Time { return clock }
	hook, _ := f.createOutgoing(t, endpoint.srv.URL+"/hook", []string{EventMessageCreated}, "")

	f.enqueueMessage(t, "with a job")
	queued := f.jobs.pop(t)
	if row, err := f.svc.q.GetDelivery(ctx, queued.args.DeliveryID); err != nil || row.JobID == nil {
		t.Fatalf("the queued row's job id: %+v, %v", row, err)
	}

	old := clock.Add(-lostAfter - time.Minute)
	discardedJob, goneJob, liveJob := rowid.New(), rowid.New(), rowid.New()
	f.jobs.statuses = map[string]JobStatus{
		discardedJob: {Discarded: true, Error: "the receiver answered HTTP 500"},
		liveJob:      {},
	}
	discarded := f.seedUnfinished(t, hook.Id, 2, old, discardedJob)
	gone := f.seedUnfinished(t, hook.Id, 3, old, goneJob)
	unqueued := f.seedUnfinished(t, hook.Id, 4, old, "")
	live := f.seedUnfinished(t, hook.Id, 5, old, liveJob)
	young := f.seedUnfinished(t, hook.Id, 6, clock.Add(-time.Minute), "")

	finished, err := f.svc.SweepLostDeliveries(ctx)
	if err != nil || finished != 3 {
		t.Fatalf("SweepLostDeliveries = %d, %v", finished, err)
	}
	finishedWith := map[string]string{}
	for _, row := range f.listDeliveries(t, hook.Id) {
		if row.FinishedAt != nil {
			finishedWith[row.Id] = row.Error
		}
	}
	want := map[string]string{
		discarded: "its job was discarded: the receiver answered HTTP 500",
		gone:      "its job is gone",
		unqueued:  "no job was queued for it",
	}
	for id, reason := range want {
		if finishedWith[id] != reason {
			t.Errorf("row %s finished with %q, want %q", id, finishedWith[id], reason)
		}
	}
	for _, id := range []string{live, young, queued.args.DeliveryID} {
		if _, finished := finishedWith[id]; finished {
			t.Errorf("row %s was finished by the sweep", id)
		}
	}
	if stats, err := f.svc.DeliveryStats(ctx); err != nil || stats != (DeliveryStats{Dead: 3, DeadLastHour: 3, Hooks: 1}) {
		t.Errorf("stats after the sweep = %+v, %v", stats, err)
	}

	again, err := f.svc.RedeliverDelivery(f.admin, connect.NewRequest(&integrationsv1.RedeliverDeliveryRequest{DeliveryId: discarded}))
	if err != nil {
		t.Fatal(err)
	}
	job := f.jobs.pop(t)
	if job.args.DeliveryID != again.Msg.Delivery.Id || string(job.args.Body) != `{"id":"`+discarded+`"}` || job.args.Sequence != 2 {
		t.Errorf("sent again as %+v", job)
	}
}

// A failure before the POST is NotSent, so the dispatcher gives the try
// back; one after it is an ordinary failure.
func TestDeliveryLookupFailuresAreNotSent(t *testing.T) {
	f, endpoint := outgoingFixture(t)
	f.createOutgoing(t, endpoint.srv.URL, []string{"message.created"}, "")
	f.enqueueMessage(t, "hello")
	job := f.jobs.pop(t)

	f.policy.failOutgoing = errors.New("settings unreadable")
	if _, err := f.svc.DeliverWebhook(context.Background(), job.args, 1, testMaxAttempts); err == nil || !NotSent(err) {
		t.Errorf("an unreadable outgoing switch: %v, NotSent=%v", err, NotSent(err))
	}
	f.policy.failOutgoing = nil

	unreadable := job.args
	unreadable.HookID = "not-a-uuid"
	if _, err := f.svc.DeliverWebhook(context.Background(), unreadable, 1, testMaxAttempts); err == nil || !NotSent(err) {
		t.Errorf("an unreadable hook: %v, NotSent=%v", err, NotSent(err))
	}
	if len(endpoint.deliveries()) != 0 {
		t.Errorf("the receiver heard %d posts", len(endpoint.deliveries()))
	}
	if NotSent(errors.New("insert failed")) {
		t.Error("a plain error read as NotSent")
	}
	if result := f.deliver(t, job, 1); !result.Delivered {
		t.Errorf("delivery once the reads work: %+v", result)
	}
}

// A refusal logs what the receiver said, at info, so an operator can see
// why; a delivered event logs nothing of it.
func TestOutgoingLogsARefusedReply(t *testing.T) {
	for _, test := range []struct {
		status int
		logged bool
	}{{http.StatusInternalServerError, true}, {http.StatusOK, false}} {
		f, _ := outgoingFixture(t)
		var logs bytes.Buffer
		f.svc.log = slog.New(slog.NewTextHandler(&logs, nil))
		srv := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.WriteHeader(test.status)
			_, _ = io.WriteString(writer, "receiver says no")
		}))
		t.Cleanup(srv.Close)
		f.createOutgoing(t, srv.URL, []string{EventMessageCreated}, "")
		f.enqueueMessage(t, "hello")
		f.drain(t)
		got := strings.Contains(logs.String(), `msg="webhook delivery refused"`) && strings.Contains(logs.String(), "receiver says no")
		if got != test.logged {
			t.Errorf("status %d: reply logged %v, want %v\n%s", test.status, got, test.logged, logs.String())
		}
	}
}
