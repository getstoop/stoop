package push

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/events"
)

// watching is whether the listener's subscription holds the person's
// topic.
func (s *Service) watching(userID string) bool {
	s.listener.mu.Lock()
	defer s.listener.mu.Unlock()
	return s.listener.sub != nil && s.listener.sub.Has(events.UserTopic(userID))
}

// Each rule, alone, keeps an item that would otherwise be queued from
// being queued.
func TestEachRuleSkips(t *testing.T) {
	cases := []struct {
		name string
		edit func(*rig, *chatv1.ActivityItem)
	}{
		{"born read", func(_ *rig, item *chatv1.ActivityItem) { item.ReadAt = timestamppb.Now() }},
		{"muted", func(_ *rig, item *chatv1.ActivityItem) { item.Muted = true }},
		{"push off", func(bench *rig, _ *chatv1.ActivityItem) { bench.svc.UsePolicy(offPolicy{}) }},
		{"do not disturb", func(bench *rig, _ *chatv1.ActivityItem) { bench.accounts.dnd = true }},
		{"kind not wanted", func(_ *rig, item *chatv1.ActivityItem) {
			item.Kind = chatv1.ActivityKind_ACTIVITY_KIND_THREAD_REPLY
		}},
		{"live socket", func(bench *rig, _ *chatv1.ActivityItem) { bench.sockets.connected[bench.sessionID] = true }},
		{"expired session", func(bench *rig, _ *chatv1.ActivityItem) { bench.accounts.expired[bench.sessionID] = true }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			bench := newRig(t)
			item := mention()
			tc.edit(bench, item)
			if err := bench.svc.itemHeard(context.Background(), bench.user, item); err != nil {
				t.Fatal(err)
			}
			if queued := bench.jobs.taken(); len(queued) != 0 {
				t.Errorf("%d deliveries queued, want none", len(queued))
			}
		})
	}

	bench := newRig(t)
	before := time.Now()
	if err := bench.svc.itemHeard(context.Background(), bench.user, mention()); err != nil {
		t.Fatal(err)
	}
	queued := bench.jobs.taken()
	if len(queued) != 1 {
		t.Fatalf("%d deliveries queued with no rule against it, want 1", len(queued))
	}
	args := queued[0]
	if args.SubscriptionID != bench.subID || args.Item.UserID != bench.user || args.Item.ActorName != "Grace Hopper" {
		t.Errorf("args = %+v", args)
	}
	if ttl := args.Expires.Sub(before); ttl < 23*time.Hour || ttl > 25*time.Hour {
		t.Errorf("expires %s after hearing, want a day", ttl)
	}
}

// Only the session with the live socket is skipped: another device of
// the same person still gets it.
func TestLiveSocketSkipsOnlyItsSession(t *testing.T) {
	bench := newRig(t)
	bench.sockets.connected[bench.sessionID] = true
	phone, _ := bench.session2(t)
	if err := bench.svc.itemHeard(context.Background(), bench.user, mention()); err != nil {
		t.Fatal(err)
	}
	queued := bench.jobs.taken()
	if len(queued) != 1 || queued[0].SubscriptionID == bench.subID || queued[0].SubscriptionID != phone {
		t.Errorf("queued %+v, want only the other device's", queued)
	}
}

// The listener hears a registered person's topic, including someone who
// registers after it started, and nobody else's.
func TestListenerHearsRegisteredPeople(t *testing.T) {
	bench := newRig(t)
	bus := events.NewInProcBus()
	bench.svc.UseSending(bus, bench.accounts, fakeChat{}, bench.jobs, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go bench.svc.RunListener(ctx)
	waitFor(t, func() bool { return bench.svc.watching(bench.user) })

	publish := func(userID string) {
		bus.Publish(events.UserTopic(userID), events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_ActivityItemCreated{
				ActivityItemCreated: &realtimev1.ActivityItemCreated{Item: mention(), UserId: userID},
			},
		}))
	}
	publish("0193a5b2-0000-7000-8000-00000000ffff")
	publish(bench.user)
	waitFor(t, func() bool { return len(bench.jobs.taken()) == 1 })

	// A second registration on another device adds nothing to watch, and
	// is heard on the topic already watched.
	bench.session2(t)
	publish(bench.user)
	waitFor(t, func() bool { return len(bench.jobs.taken()) == 3 })
	for _, args := range bench.jobs.taken() {
		if args.Item.UserID != bench.user {
			t.Errorf("queued for %s", args.Item.UserID)
		}
	}
}

// session2 signs ada in on a second device registered for mentions, and
// returns that subscription's id.
func (bench *rig) session2(t *testing.T) (string, string) {
	t.Helper()
	ctx, session := bench.session(t)
	req := validRegistration(t)
	req.Endpoint = bench.relay.server.URL + "/push/device-2"
	if _, err := bench.svc.RegisterPushSubscription(ctx, connect.NewRequest(req)); err != nil {
		t.Fatal(err)
	}
	var id string
	if err := bench.pool.QueryRow(context.Background(),
		`SELECT id FROM push_subscriptions WHERE credential_id = $1`, session).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id, session
}

func waitFor(t *testing.T, done func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !done() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
