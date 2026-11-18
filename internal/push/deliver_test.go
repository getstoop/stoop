package push

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
)

// heard queues the mention through the rules and returns its one
// delivery.
func (bench *rig) heard(t *testing.T, item *chatv1.ActivityItem) DeliveryArgs {
	t.Helper()
	if err := bench.svc.itemHeard(context.Background(), bench.user, item); err != nil {
		t.Fatal(err)
	}
	queued := bench.jobs.taken()
	if len(queued) == 0 {
		t.Fatal("nothing queued")
	}
	return queued[len(queued)-1]
}

// A delivery reaches the relay encrypted to the device, opens with the
// device's private key, and says what the contract says.
func TestDeliveryOpensWithTheDeviceKey(t *testing.T) {
	bench := newRig(t)
	args := bench.heard(t, mention())
	verdict, err := bench.svc.DeliverPush(context.Background(), args, 1)
	if err != nil || verdict != (Verdict{Done: true}) {
		t.Fatalf("verdict %+v, err %v", verdict, err)
	}
	got := bench.relay.received()
	if len(got) != 1 {
		t.Fatalf("%d posts, want 1", len(got))
	}
	post := got[0]
	if post.path != "/push/device-1" || post.header.Get("Content-Encoding") != "aes128gcm" {
		t.Errorf("post %s with %q", post.path, post.header.Get("Content-Encoding"))
	}
	if ttl, _ := strconv.Atoi(post.header.Get("TTL")); ttl < 86000 || ttl > 86400 {
		t.Errorf("TTL = %q, want about a day", post.header.Get("TTL"))
	}
	if topic := post.header.Get("Topic"); !regexp.MustCompile(`^[A-Za-z0-9_-]{32}$`).MatchString(topic) || topic != pushTopic(args.Item) {
		t.Errorf("Topic = %q", topic)
	}
	if strings.Contains(post.header.Get("Topic"), args.Item.ID) {
		t.Error("the topic shows the item id")
	}

	var payload map[string]any
	if err := json.Unmarshal(decryptBody(t, bench.device, bench.auth, post.body), &payload); err != nil {
		t.Fatalf("payload is not JSON: %v", err)
	}
	want := map[string]any{
		"v": 1.0, "serverId": "k3x9pq", "itemId": args.Item.ID, "kind": 1.0,
		"spaceId": args.Item.SpaceID, "channelId": args.Item.ChannelID, "threadRootId": "", "messageId": args.Item.MessageID,
		"actorName": "Bea Marsh", "preview": "@ada can you look at the build?", "previewCut": false,
		"spaceName": "The Stoop", "channelName": "general", "waiting": 3.0,
	}
	for field, value := range want {
		if payload[field] != value {
			t.Errorf("%s = %v, want %v", field, payload[field], value)
		}
	}
	if len(payload) != len(want) {
		t.Errorf("payload has %d fields, want %d: %v", len(payload), len(want), payload)
	}
	if _, _, succeeded, _ := bench.record(t); !succeeded {
		t.Error("success was not recorded")
	}
}

// Gone deletes the row; nothing else does.
func TestGoneDeletesTheSubscription(t *testing.T) {
	for _, status := range []int{http.StatusNotFound, http.StatusGone} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			bench := newRig(t)
			bench.relay.answer(status, "")
			verdict, err := bench.svc.DeliverPush(context.Background(), bench.heard(t, mention()), 1)
			if err != nil || !verdict.Done || verdict.Failure != "" {
				t.Fatalf("verdict %+v, err %v", verdict, err)
			}
			if _, _, _, ok := bench.record(t); ok {
				t.Error("the subscription outlived Gone")
			}
			// A later delivery for it finds nothing and posts nothing.
			if verdict, err := bench.svc.DeliverPush(context.Background(), bench.jobs.taken()[0], 2); err != nil || !verdict.Done {
				t.Errorf("after Gone: %+v, %v", verdict, err)
			}
			if posts := len(bench.relay.received()); posts != 1 {
				t.Errorf("%d posts, want 1", posts)
			}
		})
	}
}

// Rejected is recorded, not retried, and keeps the row, however often.
func TestRejectedIsRecordedAndKept(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusRequestEntityTooLarge} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			bench := newRig(t)
			bench.relay.answer(status, "")
			args := bench.heard(t, mention())
			for attempt := range 12 {
				verdict, err := bench.svc.DeliverPush(context.Background(), args, 1)
				if err != nil || !verdict.Done || verdict.Failure == "" || verdict.RetryIn != 0 {
					t.Fatalf("try %d: verdict %+v, err %v", attempt, verdict, err)
				}
			}
			failures, reason, _, ok := bench.record(t)
			if !ok {
				t.Fatal("a rejected subscription was deleted")
			}
			if failures != 12 || reason != "push service refused it ("+strconv.Itoa(status)+")" {
				t.Errorf("record = %d failures, %q", failures, reason)
			}
		})
	}
}

// Retry waits the backoff or Retry-After, whichever is longer, keeps the
// row, and gives up once the wait would outlast the day.
func TestRetryHonoursRetryAfterUntilTheDayIsUp(t *testing.T) {
	bench := newRig(t)
	args := bench.heard(t, mention())

	bench.relay.answer(http.StatusTooManyRequests, "600")
	verdict, err := bench.svc.DeliverPush(context.Background(), args, 1)
	if err != nil || verdict.Done || verdict.RetryIn != 10*time.Minute {
		t.Fatalf("429 with Retry-After 600: %+v, %v", verdict, err)
	}
	bench.relay.answer(http.StatusServiceUnavailable, "")
	verdict, err = bench.svc.DeliverPush(context.Background(), args, 3)
	if err != nil || verdict.Done || verdict.RetryIn != DeliveryBackoff[2] {
		t.Fatalf("503 on the third try: %+v, %v", verdict, err)
	}
	if failures, reason, _, ok := bench.record(t); !ok || failures != 2 || reason != "push service busy (503)" {
		t.Errorf("record = %d, %q, kept %v", failures, reason, ok)
	}

	// An hour left and a relay asking for two: give up, keep the row.
	args.Expires = time.Now().Add(time.Hour)
	bench.relay.answer(http.StatusServiceUnavailable, "7200")
	verdict, err = bench.svc.DeliverPush(context.Background(), args, 4)
	if err != nil || !verdict.Done || verdict.Failure != "gave up after a day: push service busy (503)" {
		t.Fatalf("past the day: %+v, %v", verdict, err)
	}
	// Past the day before trying: nothing is posted.
	posts := len(bench.relay.received())
	args.Expires = time.Now().Add(-time.Minute)
	if verdict, err = bench.svc.DeliverPush(context.Background(), args, 5); err != nil || !verdict.Done || verdict.Failure == "" {
		t.Fatalf("expired: %+v, %v", verdict, err)
	}
	if len(bench.relay.received()) != posts {
		t.Error("an expired delivery was posted")
	}
	if _, _, _, ok := bench.record(t); !ok {
		t.Error("giving up deleted the subscription")
	}
}

// No answer at all is retried; an address that is not public is not.
func TestUnansweredPosts(t *testing.T) {
	bench := newRig(t)
	args := bench.heard(t, mention())
	bench.relay.server.Close()
	verdict, err := bench.svc.DeliverPush(context.Background(), args, 1)
	if err != nil || verdict.Done || verdict.RetryIn != DeliveryBackoff[0] || verdict.Failure != reasonNoAnswer {
		t.Fatalf("relay down: %+v, %v", verdict, err)
	}
	if _, _, _, ok := bench.record(t); !ok {
		t.Error("a relay down deleted the subscription")
	}

	// Production's client: the local relay is not a public address.
	guarded := New(bench.pool)
	if _, err = guarded.DeliverPush(context.Background(), args, 1); err == nil {
		t.Fatal("delivered with no chat wired")
	}
	guarded.UseSending(nil, bench.accounts, fakeChat{}, bench.jobs, nil)
	verdict, err = guarded.DeliverPush(context.Background(), args, 1)
	if err != nil || !verdict.Done || verdict.Failure != reasonNotPublic {
		t.Fatalf("private address through netguard: %+v, %v", verdict, err)
	}
}

// A channel deleted since leaves nothing to open: done, nothing posted.
func TestDeletedChannelIsNotSent(t *testing.T) {
	bench := newRig(t)
	args := bench.heard(t, mention())
	bench.svc.UseSending(nil, bench.accounts, fakeChat{err: connect.NewError(connect.CodeNotFound, nil)}, bench.jobs, nil)
	verdict, err := bench.svc.DeliverPush(context.Background(), args, 1)
	if err != nil || verdict != (Verdict{Done: true}) || len(bench.relay.received()) != 0 {
		t.Fatalf("verdict %+v, err %v, posts %d", verdict, err, len(bench.relay.received()))
	}
}

// The Diagnostics numbers count devices and the failing ones by reason.
func TestDeliveryStats(t *testing.T) {
	bench := newRig(t)
	stats, err := bench.svc.DeliveryStats(context.Background())
	if err != nil || stats.Devices != 1 || stats.Failing != 0 || len(stats.Reasons) != 0 {
		t.Fatalf("stats %+v, %v", stats, err)
	}
	bench.relay.answer(http.StatusForbidden, "")
	if _, err := bench.svc.DeliverPush(context.Background(), bench.heard(t, mention()), 1); err != nil {
		t.Fatal(err)
	}
	stats, err = bench.svc.DeliveryStats(context.Background())
	if err != nil || stats.Devices != 1 || stats.Failing != 1 || len(stats.Reasons) != 1 ||
		stats.Reasons[0].Reason != "push service refused it (403)" || stats.Reasons[0].Devices != 1 {
		t.Fatalf("stats %+v, %v", stats, err)
	}
	// A success clears the failing count.
	bench.relay.answer(http.StatusCreated, "")
	if _, err := bench.svc.DeliverPush(context.Background(), bench.jobs.taken()[0], 1); err != nil {
		t.Fatal(err)
	}
	if stats, _ = bench.svc.DeliveryStats(context.Background()); stats.Failing != 0 {
		t.Errorf("failing %d after a success", stats.Failing)
	}
}
