package eventrelay

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/restart"
)

const waitTimeout = 15 * time.Second

// relay is a publisher on one bus and a listener on another, the way a
// `stoop jobs` process and the server hold them, over one database.
type relay struct {
	publisher *Publisher
	server    *events.InProcBus
	listened  chan struct{}
	log       *lockedBuffer
}

// lockedBuffer collects log lines written from the test and the
// listener's goroutine.
type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func newRelay(t *testing.T, pool *pgxpool.Pool) *relay {
	t.Helper()
	logBuffer := &lockedBuffer{}
	log := slog.New(slog.NewTextHandler(logBuffer, &slog.HandlerOptions{Level: slog.LevelDebug}))
	runner := events.NewInProcBus()
	server := events.NewInProcBus()
	listener := NewListener(server, pool, log)
	listened := make(chan struct{}, 4)
	listener.listening = func() { listened <- struct{}{} }
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		listener.Run(ctx)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(waitTimeout):
			t.Error("the listener did not stop")
		}
	})
	awaitListening(t, listened)
	return &relay{publisher: NewPublisher(runner, pool, log), server: server, listened: listened, log: logBuffer}
}

func awaitListening(t *testing.T, listened <-chan struct{}) {
	t.Helper()
	select {
	case <-listened:
	case <-time.After(waitTimeout):
		t.Fatal("the listener did not come up")
	}
}

func receive(t *testing.T, sub *events.Subscription) *realtimev1.ServerEvent {
	t.Helper()
	select {
	case ev, ok := <-sub.Events():
		if !ok {
			t.Fatal("the subscription closed")
		}
		return ev
	case <-time.After(waitTimeout):
		t.Fatal("no event arrived")
	}
	return nil
}

func memberUpdated(spaceID, userID string) *realtimev1.ServerEvent {
	return events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MemberUpdated{
			MemberUpdated: &realtimev1.MemberUpdated{SpaceId: spaceID, UserId: userID},
		},
	})
}

func TestPublishOnOneBusReachesASubscriberOnTheOther(t *testing.T) {
	pool := dbtest.New(t)
	r := newRelay(t, pool)
	sub := r.server.Subscribe(events.SpaceTopic("s1"))
	defer sub.Close()

	sent := memberUpdated("s1", "u1")
	r.publisher.Publish(events.SpaceTopic("s1"), sent)
	r.publisher.Publish(events.SpaceTopic("other"), memberUpdated("other", "u1"))

	got := receive(t, sub)
	if got.GetEventId() != sent.GetEventId() {
		t.Errorf("event_id = %q, want %q", got.GetEventId(), sent.GetEventId())
	}
	if !got.GetTs().AsTime().Equal(sent.GetTs().AsTime()) {
		t.Errorf("ts = %v, want %v", got.GetTs().AsTime(), sent.GetTs().AsTime())
	}
	updated := got.GetMemberUpdated()
	if updated == nil || updated.GetSpaceId() != "s1" || updated.GetUserId() != "u1" {
		t.Errorf("payload = %v, want member_updated s1/u1", got.GetPayload())
	}
	// The other topic's event must not have reached this subscription.
	if pending := len(sub.Events()); pending != 0 {
		t.Errorf("%d more events arrived, want none", pending)
	}
}

func TestOversizeEventIsDroppedAndLogged(t *testing.T) {
	pool := dbtest.New(t)
	r := newRelay(t, pool)
	sub := r.server.Subscribe(events.SpaceTopic("s1"))
	defer sub.Close()

	huge := events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MessageCreated{
			MessageCreated: &chatv1.Message{Content: strings.Repeat("x", maxPayload)},
		},
	})
	r.publisher.Publish(events.SpaceTopic("s1"), huge)
	after := memberUpdated("s1", "u1")
	r.publisher.Publish(events.SpaceTopic("s1"), after)

	// Notifications on one channel arrive in order, so the first event
	// on the server is the one after the dropped one.
	if got := receive(t, sub); got.GetEventId() != after.GetEventId() {
		t.Errorf("first relayed event_id = %q, want %q (the oversize one must be dropped)", got.GetEventId(), after.GetEventId())
	}
	if logged := r.log.String(); !strings.Contains(logged, "dropped") || !strings.Contains(logged, huge.GetEventId()) {
		t.Errorf("the drop was not logged with its event id:\n%s", logged)
	}
}

func TestListenerReconnectsAfterItsBackendIsTerminated(t *testing.T) {
	pool := dbtest.New(t)
	r := newRelay(t, pool)
	sub := r.server.Subscribe(events.SpaceTopic("s1"))
	defer sub.Close()

	if _, err := pool.Exec(context.Background(), `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
		WHERE pid <> pg_backend_pid() AND datname = current_database() AND query ILIKE 'LISTEN%stoop_events%'`); err != nil {
		t.Fatal(err)
	}
	awaitListening(t, r.listened)

	sent := memberUpdated("s1", "u1")
	published := time.Now()
	r.publisher.Publish(events.SpaceTopic("s1"), sent)
	if got := receive(t, sub); got.GetEventId() != sent.GetEventId() {
		t.Errorf("event_id = %q, want %q", got.GetEventId(), sent.GetEventId())
	}
	if took := time.Since(published); took > restart.BackoffMin+2*time.Second {
		t.Errorf("the event took %v to arrive after the reconnect", took)
	}
	if !strings.Contains(r.log.String(), "relay listener stopped; retrying") {
		t.Errorf("the reconnect was not logged:\n%s", r.log.String())
	}
}
