package integrations

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sync"
	"time"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

// The subscriber: bus events in, one fan-out job per event out. No HTTP
// and no per-hook writes here, so neither a slow receiver nor a space
// with many hooks holds the bus's buffer. See
// docs/architecture/integrations.md → Outgoing.

// Event types, v1.
const (
	EventMessageCreated = "message.created"
	EventMessageUpdated = "message.updated"
	EventMessageDeleted = "message.deleted"
	EventMemberJoined   = "member.joined"
	EventMemberLeft     = "member.left"
	EventChannelCreated = "channel.created"
	EventChannelDeleted = "channel.deleted"
	EventWebhookTest    = "webhook.test"
)

// EventTypes is the catalogue a hook may subscribe to.
var EventTypes = []string{
	EventMessageCreated, EventMessageUpdated, EventMessageDeleted,
	EventMemberJoined, EventMemberLeft, EventChannelCreated, EventChannelDeleted,
}

// envelope is the delivery body.
type envelope struct {
	ID       string          `json:"id"`
	Type     string          `json:"type"`
	TS       time.Time       `json:"ts"`
	Instance string          `json:"instance"`
	Space    envelopeSpace   `json:"space"`
	Data     json.RawMessage `json:"data"`
}

type envelopeSpace struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// OutgoingEvent is one bus event translated for hooks, and the fan-out
// job's args. EventID is the bus event's id; At is when it happened, the
// envelope's ts.
type OutgoingEvent struct {
	EventID   string          `json:"event_id,omitempty"`
	Type      string          `json:"type"`
	SpaceID   string          `json:"space_id"`
	ChannelID string          `json:"channel_id,omitempty"`
	Data      json.RawMessage `json:"data"`
	At        time.Time       `json:"at"`
}

// translate maps a realtime event to a hook event stamped with the
// event's time, or false for the kinds hooks never see.
func (s *Service) translate(ctx context.Context, ev *realtimev1.ServerEvent) (OutgoingEvent, bool) {
	out, ok := s.translatePayload(ctx, ev)
	out.EventID = ev.EventId
	out.At = s.now()
	if ev.Ts != nil {
		out.At = ev.Ts.AsTime()
	}
	return out, ok
}

func (s *Service) translatePayload(ctx context.Context, ev *realtimev1.ServerEvent) (OutgoingEvent, bool) {
	switch p := ev.Payload.(type) {
	case *realtimev1.ServerEvent_MessageCreated:
		return s.messageEvent(ctx, EventMessageCreated, p.MessageCreated.ChannelId, p.MessageCreated.SpaceId, p.MessageCreated)
	case *realtimev1.ServerEvent_MessageUpdated:
		return s.messageEvent(ctx, EventMessageUpdated, p.MessageUpdated.ChannelId, p.MessageUpdated.SpaceId, p.MessageUpdated)
	case *realtimev1.ServerEvent_MessageDeleted:
		if p.MessageDeleted.SpaceId == "" {
			return OutgoingEvent{}, false
		}
		return OutgoingEvent{Type: EventMessageDeleted, SpaceID: p.MessageDeleted.SpaceId, ChannelID: p.MessageDeleted.ChannelId,
			Data: rawJSON(map[string]string{"channel_id": p.MessageDeleted.ChannelId, "message_id": p.MessageDeleted.MessageId})}, true
	case *realtimev1.ServerEvent_MemberJoined:
		data := rawJSON(map[string]string{"space_id": p.MemberJoined.SpaceId, "user_id": p.MemberJoined.UserId})
		if s.spaces != nil {
			if m, err := s.spaces.Member(ctx, p.MemberJoined.SpaceId, p.MemberJoined.UserId); err == nil {
				data = protoJSON(m)
			}
		}
		return OutgoingEvent{Type: EventMemberJoined, SpaceID: p.MemberJoined.SpaceId, Data: data}, true
	case *realtimev1.ServerEvent_MemberRemoved:
		reason := "left"
		if p.MemberRemoved.Kicked {
			reason = "removed"
		}
		return OutgoingEvent{Type: EventMemberLeft, SpaceID: p.MemberRemoved.SpaceId,
			Data: rawJSON(map[string]string{"space_id": p.MemberRemoved.SpaceId, "user_id": p.MemberRemoved.UserId, "reason": reason})}, true
	case *realtimev1.ServerEvent_ChannelCreated:
		if p.ChannelCreated.SpaceId == "" {
			return OutgoingEvent{}, false
		}
		return OutgoingEvent{Type: EventChannelCreated, SpaceID: p.ChannelCreated.SpaceId, ChannelID: p.ChannelCreated.Id, Data: protoJSON(p.ChannelCreated)}, true
	case *realtimev1.ServerEvent_ChannelDeleted:
		return OutgoingEvent{Type: EventChannelDeleted, SpaceID: p.ChannelDeleted.SpaceId, ChannelID: p.ChannelDeleted.ChannelId,
			Data: rawJSON(map[string]string{"space_id": p.ChannelDeleted.SpaceId, "channel_id": p.ChannelDeleted.ChannelId})}, true
	}
	return OutgoingEvent{}, false
}

func (s *Service) messageEvent(ctx context.Context, typ, channelID, spaceID string, m proto.Message) (OutgoingEvent, bool) {
	if spaceID == "" && s.spaces != nil {
		var err error
		if spaceID, err = s.spaces.ChannelSpace(ctx, channelID); err != nil {
			return OutgoingEvent{}, false
		}
	}
	if spaceID == "" {
		return OutgoingEvent{}, false
	}
	return OutgoingEvent{Type: typ, SpaceID: spaceID, ChannelID: channelID, Data: protoJSON(m)}, true
}

func protoJSON(m proto.Message) json.RawMessage {
	b, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(m)
	if err != nil {
		return json.RawMessage("{}")
	}
	return b
}

func rawJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

// enqueue queues one fan-out job for the event in its space's lane. With
// outgoing off, or no enabled hook in the space wanting the event,
// nothing is queued.
func (s *Service) enqueue(ctx context.Context, ev OutgoingEvent) error {
	if s.jobs == nil {
		return nil
	}
	if on, err := s.outgoingEnabled(ctx); err != nil || !on {
		return err
	}
	hooks, err := s.q.ListEnabledOutgoingWebhooksBySpace(ctx, ev.SpaceID)
	if err != nil {
		return fmt.Errorf("list hooks: %w", err)
	}
	if !slices.ContainsFunc(hooks, func(hook dbgen.OutgoingWebhook) bool { return hookWants(hook, ev) }) {
		return nil
	}
	if _, err := s.jobs.EnqueueInLane(ctx, FanOutWebhookEventKind, ev, ev.SpaceID, s.subs.nextSequence(ev.At)); err != nil {
		return fmt.Errorf("queue fan-out: %w", err)
	}
	return nil
}

// hookWants reports whether the hook takes the event: its type, and its
// channel when the hook has a filter and the event a channel.
func hookWants(hook dbgen.OutgoingWebhook, ev OutgoingEvent) bool {
	if !slices.Contains(hook.EventTypes, ev.Type) {
		return false
	}
	return hook.ChannelID == nil || ev.ChannelID == "" || *hook.ChannelID == ev.ChannelID
}

// subscriber watches the space topics of every space with an enabled
// outgoing hook. Topics are added as hooks are made and never removed:
// an event in a space with no hooks costs one indexed read.
type subscriber struct {
	mu  sync.Mutex
	sub *events.Subscription
	// lastSequence is the last fan-out's lane sequence; only the
	// consuming goroutine touches it.
	lastSequence int64
}

// nextSequence is the event's time in nanoseconds, moved past the last
// one so a lane stays in the order events were read.
func (sub *subscriber) nextSequence(at time.Time) int64 {
	sub.lastSequence = max(sub.lastSequence+1, at.UnixNano())
	return sub.lastSequence
}

// RunSubscriber consumes the bus until ctx ends. A dropped subscription
// (the consumer fell behind) is re-opened, and the events published
// before that are lost to every hook alike: the sequence is taken at
// fan-out, so Stoop-Sequence shows no gap for them.
func (s *Service) RunSubscriber(ctx context.Context) {
	if s.bus == nil || s.jobs == nil {
		return
	}
	for ctx.Err() == nil {
		topics, err := s.watchedTopics(ctx)
		if err != nil {
			s.log.Warn("list hook spaces", "err", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
				continue
			}
		}
		sub := s.bus.Subscribe(topics...)
		s.subs.mu.Lock()
		s.subs.sub = sub
		s.subs.mu.Unlock()
		s.consume(ctx, sub)
		sub.Close()
	}
}

func (s *Service) consume(ctx context.Context, sub *events.Subscription) {
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-sub.Events():
			if !ok {
				s.log.Warn("hook subscriber fell behind; resubscribing")
				return
			}
			out, want := s.translate(ctx, ev)
			if !want {
				continue
			}
			if err := s.enqueue(ctx, out); err != nil && ctx.Err() == nil {
				s.log.Error("enqueue hook fan-out", "event", out.Type, "err", err)
			}
		}
	}
}

func (s *Service) watchedTopics(ctx context.Context) ([]string, error) {
	hooks, err := s.q.ListOutgoingWebhooks(ctx)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var topics []string
	for _, h := range hooks {
		if !seen[h.SpaceID] {
			seen[h.SpaceID] = true
			topics = append(topics, events.SpaceTopic(h.SpaceID))
		}
	}
	return topics, nil
}

// watchSpace adds a space's topic to the live subscription, for a hook
// made after startup.
func (s *Service) watchSpace(spaceID string) {
	s.subs.mu.Lock()
	defer s.subs.mu.Unlock()
	if s.subs.sub != nil && !s.subs.sub.Has(events.SpaceTopic(spaceID)) {
		s.subs.sub.Add(events.SpaceTopic(spaceID))
	}
}
