package integrations

import (
	"context"
	"errors"
	"testing"
	"time"
)

// translateMessage is a message.created for the fixture's channel.
func (f *fixture) translateMessage(t *testing.T, content string) OutgoingEvent {
	t.Helper()
	out, ok := f.svc.translate(context.Background(), message(f.channel, f.space, content))
	if !ok {
		t.Fatal("message not translated")
	}
	return out
}

func (f *fixture) countRows(t *testing.T, query string, args ...any) int64 {
	t.Helper()
	var count int64
	if err := f.pool.QueryRow(context.Background(), query, args...).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

// The subscriber's whole job per event: one fan-out job in the space's
// lane, in the order the events came, and no delivery rows.
func TestSubscriberQueuesOneFanOutPerEvent(t *testing.T) {
	f, endpoint := outgoingFixture(t)
	for _, path := range []string{"/one", "/two", "/three"} {
		f.createOutgoing(t, endpoint.srv.URL+path, []string{EventMessageCreated}, "")
	}
	for _, content := range []string{"first", "second"} {
		if err := f.svc.enqueue(context.Background(), f.translateMessage(t, content)); err != nil {
			t.Fatal(err)
		}
	}
	fanOuts := f.jobs.takeFanOuts()
	if len(fanOuts) != 2 || f.jobs.pending() != 0 {
		t.Fatalf("queued %d fan-outs and %d other jobs, want 2 and none", len(fanOuts), f.jobs.pending())
	}
	for _, job := range fanOuts {
		if job.lane != f.space || job.inTx {
			t.Errorf("fan-out %+v", job)
		}
	}
	if fanOuts[0].sequence >= fanOuts[1].sequence {
		t.Errorf("lane sequences %d then %d", fanOuts[0].sequence, fanOuts[1].sequence)
	}
	if rows := f.countRows(t, `SELECT count(*) FROM webhook_deliveries`); rows != 0 {
		t.Errorf("the subscriber wrote %d delivery rows", rows)
	}
}

// The subscriber's sequence follows the order events were read even when
// their clocks disagree.
func TestNextSequenceNeverGoesBack(t *testing.T) {
	var sub subscriber
	at := time.Now()
	first := sub.nextSequence(at)
	second := sub.nextSequence(at.Add(-1))
	third := sub.nextSequence(at)
	if first != at.UnixNano() || second != first+1 || third != second+1 {
		t.Errorf("sequences %d %d %d", first, second, third)
	}
}

// A fan-out writes a row and a job per matching hook, each hook's
// sequences in the order of the events.
func TestFanOutQueuesEachHookInEventOrder(t *testing.T) {
	f, endpoint := outgoingFixture(t)
	hookIDs := map[string]bool{}
	for _, path := range []string{"/one", "/two", "/three"} {
		hook, _ := f.createOutgoing(t, endpoint.srv.URL+path, []string{EventMessageCreated}, "")
		hookIDs[hook.Id] = true
	}
	contents := []string{"first", "second", "third"}
	for _, content := range contents {
		f.enqueue(t, f.translateMessage(t, content))
	}
	if f.jobs.pending() != len(hookIDs)*len(contents) {
		t.Fatalf("%d deliveries queued, want %d", f.jobs.pending(), len(hookIDs)*len(contents))
	}
	seen := map[string]int64{}
	for f.jobs.pending() > 0 {
		job := f.jobs.pop(t)
		if !hookIDs[job.args.HookID] || !job.inTx {
			t.Fatalf("delivery %+v", job)
		}
		seen[job.args.HookID]++
		if job.sequence != seen[job.args.HookID] {
			t.Errorf("hook %s: sequence %d, want %d", job.args.HookID, job.sequence, seen[job.args.HookID])
		}
		if res := f.deliver(t, job, 1); !res.Delivered {
			t.Fatalf("delivery: %+v", res)
		}
	}
	for hookID := range hookIDs {
		logged := f.listDeliveries(t, hookID)
		if len(logged) != len(contents) {
			t.Errorf("hook %s logged %d deliveries", hookID, len(logged))
		}
	}
}

// A fan-out that fails part-way leaves no row, no job and no spent
// sequence; its retry delivers to every hook from sequence 1.
func TestFailedFanOutLeavesNothing(t *testing.T) {
	f, endpoint := outgoingFixture(t)
	f.createOutgoing(t, endpoint.srv.URL+"/first", []string{EventMessageCreated}, "")
	second, _ := f.createOutgoing(t, endpoint.srv.URL+"/second", []string{EventMessageCreated}, "")
	if err := f.svc.enqueue(context.Background(), f.translateMessage(t, "all or nothing")); err != nil {
		t.Fatal(err)
	}
	fanOuts := f.jobs.takeFanOuts()
	if len(fanOuts) != 1 {
		t.Fatalf("%d fan-outs queued", len(fanOuts))
	}

	queueDown := errors.New("the queue is down")
	f.jobs.refuse = queueDown
	f.jobs.refuseLane = second.Id
	if err := f.svc.FanOutWebhookEvent(context.Background(), fanOuts[0].event); !errors.Is(err, queueDown) {
		t.Fatalf("fan-out with one lane refused: %v", err)
	}
	if pending := f.jobs.pending(); pending != 0 {
		t.Errorf("%d deliveries queued by a failed fan-out", pending)
	}
	if rows := f.countRows(t, `SELECT count(*) FROM webhook_deliveries`); rows != 0 {
		t.Errorf("%d delivery rows left by a failed fan-out", rows)
	}
	if spent := f.countRows(t, `SELECT count(*) FROM outgoing_webhooks WHERE sequence <> 0`); spent != 0 {
		t.Errorf("%d hooks spent a sequence on a failed fan-out", spent)
	}

	f.jobs.refuse = nil
	if err := f.svc.FanOutWebhookEvent(context.Background(), fanOuts[0].event); err != nil {
		t.Fatal(err)
	}
	if results := f.drain(t); len(results) != 2 {
		t.Fatalf("retry delivered %d", len(results))
	}
	for _, got := range endpoint.deliveries() {
		if got.headers.Get("Stoop-Sequence") != "1" {
			t.Errorf("retry's sequence %q, want 1", got.headers.Get("Stoop-Sequence"))
		}
	}
}

// A fan-out run again after it committed (its outcome was never written)
// queues nothing twice and spends no sequence.
func TestCommittedFanOutRunAgainQueuesNothing(t *testing.T) {
	f, endpoint := outgoingFixture(t)
	f.createOutgoing(t, endpoint.srv.URL+"/one", []string{EventMessageCreated}, "")
	f.createOutgoing(t, endpoint.srv.URL+"/two", []string{EventMessageCreated}, "")
	event := f.translateMessage(t, "once only")
	if event.EventID == "" {
		t.Fatal("the translated event has no id")
	}
	for range 2 {
		if err := f.svc.FanOutWebhookEvent(context.Background(), event); err != nil {
			t.Fatal(err)
		}
	}
	if pending := f.jobs.pending(); pending != 2 {
		t.Errorf("%d deliveries queued, want one per hook", pending)
	}
	if rows := f.countRows(t, `SELECT count(*) FROM webhook_deliveries`); rows != 2 {
		t.Errorf("%d delivery rows, want one per hook", rows)
	}
	if spent := f.countRows(t, `SELECT count(*) FROM outgoing_webhooks WHERE sequence <> 1`); spent != 0 {
		t.Errorf("%d hooks spent a sequence on the second run", spent)
	}
}

// A hook that stops wanting the event between the subscriber and the
// fan-out gets nothing; the hook that still wants it does.
func TestFanOutReadsTheHooksAtItsOwnTime(t *testing.T) {
	f, endpoint := outgoingFixture(t)
	changed, _ := f.createOutgoing(t, endpoint.srv.URL+"/changed", []string{EventMessageCreated}, "")
	kept, _ := f.createOutgoing(t, endpoint.srv.URL+"/kept", []string{EventMessageCreated}, "")
	if err := f.svc.enqueue(context.Background(), f.translateMessage(t, "after the change")); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(context.Background(), `UPDATE outgoing_webhooks SET event_types = $2 WHERE id = $1`,
		changed.Id, []string{EventMemberJoined}); err != nil {
		t.Fatal(err)
	}
	f.fanOut(t)
	if f.jobs.pending() != 1 {
		t.Fatalf("%d deliveries queued, want the kept hook's", f.jobs.pending())
	}
	if job := f.jobs.pop(t); job.args.HookID != kept.Id {
		t.Errorf("queued for hook %s, want %s", job.args.HookID, kept.Id)
	}
	if logged := f.listDeliveries(t, changed.Id); len(logged) != 0 {
		t.Errorf("the changed hook logged %d deliveries", len(logged))
	}
}

// A fan-out found queued while outgoing is off writes nothing.
func TestFanOutWithOutgoingOffWritesNothing(t *testing.T) {
	f, endpoint := outgoingFixture(t)
	f.createOutgoing(t, endpoint.srv.URL+"/hook", []string{EventMessageCreated}, "")
	if err := f.svc.enqueue(context.Background(), f.translateMessage(t, "before the switch")); err != nil {
		t.Fatal(err)
	}
	f.policy.outgoing = false
	f.fanOut(t)
	if f.jobs.pending() != 0 || f.countRows(t, `SELECT count(*) FROM webhook_deliveries`) != 0 {
		t.Error("a fan-out with outgoing off queued a delivery")
	}
}
