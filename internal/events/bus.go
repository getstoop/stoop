// Package events is the in-process pub/sub seam between modules: chat
// publishes domain events, the realtime gateway subscribes and delivers them
// to WebSocket clients. Neither module imports the other.
//
// Payloads are already-serialized-friendly protobuf envelopes, so a future
// multi-node implementation (NATS, Redis) is a marshal/unmarshal wrapper
// behind the same Bus interface.
package events

import (
	"sync"
	"time"

	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"

	realtimev1 "github.com/Jhut89/stoop/gen/stoop/realtime/v1"
)

// Topic naming: "space:<id>" for space-wide events, "user:<id>" for events
// addressed to one user (across all their connections).

type Bus interface {
	Publish(topic string, ev *realtimev1.ServerEvent)
	Subscribe(topics ...string) *Subscription
}

// Stamp fills the envelope's event ID and timestamp in place and returns it.
func Stamp(ev *realtimev1.ServerEvent) *realtimev1.ServerEvent {
	id, err := uuid.NewV7()
	if err != nil {
		id = uuid.New()
	}
	ev.EventId = id.String()
	ev.Ts = timestamppb.New(time.Now())
	return ev
}

// subscriptionBuffer bounds how far a slow consumer may lag before it is
// dropped; dropped consumers see their event channel close and are expected
// to reconnect and recover state via regular RPC reads.
const subscriptionBuffer = 256

type Subscription struct {
	bus    *InProcBus
	ch     chan *realtimev1.ServerEvent
	topics map[string]struct{}
	closed bool
}

// Events yields published events in order. The channel closes when the
// subscription is closed or dropped for falling behind.
func (s *Subscription) Events() <-chan *realtimev1.ServerEvent {
	return s.ch
}

// Add subscribes to an additional topic (e.g. after joining a server while
// connected).
func (s *Subscription) Add(topic string) {
	s.bus.add(s, topic)
}

// Has reports whether the subscription currently includes a topic.
func (s *Subscription) Has(topic string) bool {
	s.bus.mu.Lock()
	defer s.bus.mu.Unlock()
	_, ok := s.topics[topic]
	return ok
}

// Remove unsubscribes from one topic (e.g. after being removed from a
// space while connected).
func (s *Subscription) Remove(topic string) {
	s.bus.removeTopic(s, topic)
}

func (s *Subscription) Close() {
	s.bus.remove(s)
}

type InProcBus struct {
	mu     sync.Mutex
	topics map[string]map[*Subscription]struct{}
}

func NewInProcBus() *InProcBus {
	return &InProcBus{topics: map[string]map[*Subscription]struct{}{}}
}

func (b *InProcBus) Publish(topic string, ev *realtimev1.ServerEvent) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for sub := range b.topics[topic] {
		select {
		case sub.ch <- ev:
		default:
			// Slow consumer: drop it rather than block every publisher.
			b.removeLocked(sub)
		}
	}
}

func (b *InProcBus) Subscribe(topics ...string) *Subscription {
	sub := &Subscription{
		bus:    b,
		ch:     make(chan *realtimev1.ServerEvent, subscriptionBuffer),
		topics: map[string]struct{}{},
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, t := range topics {
		b.addLocked(sub, t)
	}
	return sub
}

func (b *InProcBus) add(sub *Subscription, topic string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.addLocked(sub, topic)
}

func (b *InProcBus) addLocked(sub *Subscription, topic string) {
	if sub.closed {
		return
	}
	set, ok := b.topics[topic]
	if !ok {
		set = map[*Subscription]struct{}{}
		b.topics[topic] = set
	}
	set[sub] = struct{}{}
	sub.topics[topic] = struct{}{}
}

func (b *InProcBus) removeTopic(sub *Subscription, topic string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if sub.closed {
		return
	}
	delete(sub.topics, topic)
	delete(b.topics[topic], sub)
	if len(b.topics[topic]) == 0 {
		delete(b.topics, topic)
	}
}

func (b *InProcBus) remove(sub *Subscription) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.removeLocked(sub)
}

func (b *InProcBus) removeLocked(sub *Subscription) {
	if sub.closed {
		return
	}
	sub.closed = true
	for t := range sub.topics {
		delete(b.topics[t], sub)
		if len(b.topics[t]) == 0 {
			delete(b.topics, t)
		}
	}
	close(sub.ch)
}
