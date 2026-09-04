package events

import (
	"testing"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
)

func ping() *realtimev1.ServerEvent {
	return Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_Ping{Ping: &realtimev1.Ping{}},
	})
}

func TestPublishReachesSubscribedTopics(t *testing.T) {
	bus := NewInProcBus()
	sub := bus.Subscribe("space:a", "user:u1")
	defer sub.Close()

	bus.Publish("space:a", ping())
	bus.Publish("space:other", ping())
	bus.Publish("user:u1", ping())

	if got := len(sub.Events()); got != 2 {
		t.Fatalf("expected 2 buffered events, got %d", got)
	}
}

func TestAddTopicLive(t *testing.T) {
	bus := NewInProcBus()
	sub := bus.Subscribe("user:u1")
	defer sub.Close()

	bus.Publish("space:new", ping())
	sub.Add("space:new")
	bus.Publish("space:new", ping())

	if got := len(sub.Events()); got != 1 {
		t.Fatalf("expected only the post-Add event, got %d", got)
	}
}

func TestCloseStopsDelivery(t *testing.T) {
	bus := NewInProcBus()
	sub := bus.Subscribe("space:a")
	sub.Close()

	// Publishing after close must not panic or deliver.
	bus.Publish("space:a", ping())

	if _, ok := <-sub.Events(); ok {
		t.Fatal("expected closed channel")
	}
}

func TestSlowConsumerIsDropped(t *testing.T) {
	bus := NewInProcBus()
	sub := bus.Subscribe("space:a")

	for range subscriptionBuffer + 1 {
		bus.Publish("space:a", ping())
	}

	// Drain: after subscriptionBuffer events the channel must be closed.
	count := 0
	for range sub.Events() {
		count++
	}
	if count != subscriptionBuffer {
		t.Fatalf("expected %d delivered events before drop, got %d", subscriptionBuffer, count)
	}
}

func TestSubscriptionRemove(t *testing.T) {
	bus := NewInProcBus()
	sub := bus.Subscribe("a", "b")
	defer sub.Close()
	sub.Remove("a")
	bus.Publish("a", &realtimev1.ServerEvent{EventId: "on-a"})
	bus.Publish("b", &realtimev1.ServerEvent{EventId: "on-b"})
	if got := (<-sub.Events()).EventId; got != "on-b" {
		t.Fatalf("after Remove(a), first event = %q, want on-b", got)
	}
	select {
	case ev := <-sub.Events():
		t.Fatalf("unexpected extra event %q", ev.EventId)
	default:
	}
	sub.Remove("never-subscribed") // must be a harmless no-op
}
