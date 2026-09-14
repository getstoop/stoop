package integrations

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/events"
)

// The subscriber: bus events in, queue items out. No HTTP here, so a slow
// receiver can never hold the bus's buffer. See docs/proposals/webhooks.md
// → Outgoing.

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

// outgoingEvent is one bus event translated for hooks.
type outgoingEvent struct {
	Type      string
	SpaceID   string
	ChannelID string
	Data      json.RawMessage
}

// translate maps a realtime event to a hook event, or false for the
// kinds hooks never see.
func (s *Service) translate(ctx context.Context, ev *realtimev1.ServerEvent) (outgoingEvent, bool) {
	switch p := ev.Payload.(type) {
	case *realtimev1.ServerEvent_MessageCreated:
		return s.messageEvent(ctx, EventMessageCreated, p.MessageCreated.ChannelId, p.MessageCreated.SpaceId, p.MessageCreated)
	case *realtimev1.ServerEvent_MessageUpdated:
		return s.messageEvent(ctx, EventMessageUpdated, p.MessageUpdated.ChannelId, p.MessageUpdated.SpaceId, p.MessageUpdated)
	case *realtimev1.ServerEvent_MessageDeleted:
		if p.MessageDeleted.SpaceId == "" {
			return outgoingEvent{}, false
		}
		return outgoingEvent{Type: EventMessageDeleted, SpaceID: p.MessageDeleted.SpaceId, ChannelID: p.MessageDeleted.ChannelId,
			Data: rawJSON(map[string]string{"channel_id": p.MessageDeleted.ChannelId, "message_id": p.MessageDeleted.MessageId})}, true
	case *realtimev1.ServerEvent_MemberJoined:
		data := rawJSON(map[string]string{"space_id": p.MemberJoined.SpaceId, "user_id": p.MemberJoined.UserId})
		if s.spaces != nil {
			if m, err := s.spaces.Member(ctx, p.MemberJoined.SpaceId, p.MemberJoined.UserId); err == nil {
				data = protoJSON(m)
			}
		}
		return outgoingEvent{Type: EventMemberJoined, SpaceID: p.MemberJoined.SpaceId, Data: data}, true
	case *realtimev1.ServerEvent_MemberRemoved:
		reason := "left"
		if p.MemberRemoved.Kicked {
			reason = "removed"
		}
		return outgoingEvent{Type: EventMemberLeft, SpaceID: p.MemberRemoved.SpaceId,
			Data: rawJSON(map[string]string{"space_id": p.MemberRemoved.SpaceId, "user_id": p.MemberRemoved.UserId, "reason": reason})}, true
	case *realtimev1.ServerEvent_ChannelCreated:
		if p.ChannelCreated.SpaceId == "" {
			return outgoingEvent{}, false
		}
		return outgoingEvent{Type: EventChannelCreated, SpaceID: p.ChannelCreated.SpaceId, ChannelID: p.ChannelCreated.Id, Data: protoJSON(p.ChannelCreated)}, true
	case *realtimev1.ServerEvent_ChannelDeleted:
		return outgoingEvent{Type: EventChannelDeleted, SpaceID: p.ChannelDeleted.SpaceId, ChannelID: p.ChannelDeleted.ChannelId,
			Data: rawJSON(map[string]string{"space_id": p.ChannelDeleted.SpaceId, "channel_id": p.ChannelDeleted.ChannelId})}, true
	}
	return outgoingEvent{}, false
}

func (s *Service) messageEvent(ctx context.Context, typ, channelID, spaceID string, m proto.Message) (outgoingEvent, bool) {
	if spaceID == "" && s.spaces != nil {
		var err error
		if spaceID, err = s.spaces.ChannelSpace(ctx, channelID); err != nil {
			return outgoingEvent{}, false
		}
	}
	if spaceID == "" {
		return outgoingEvent{}, false
	}
	return outgoingEvent{Type: typ, SpaceID: spaceID, ChannelID: channelID, Data: protoJSON(m)}, true
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

// enqueue renders one item per enabled hook that wants the event.
func (s *Service) enqueue(ctx context.Context, ev outgoingEvent) error {
	if s.queue == nil {
		return nil
	}
	hooks, err := s.q.ListEnabledOutgoingWebhooksBySpace(ctx, ev.SpaceID)
	if err != nil {
		return fmt.Errorf("list hooks: %w", err)
	}
	var spaceName, instance string
	named := false
	for _, h := range hooks {
		if !wants(h.EventTypes, ev.Type) || (h.ChannelID != nil && ev.ChannelID != "" && *h.ChannelID != ev.ChannelID) {
			continue
		}
		if !named {
			named = true
			if s.spaces != nil {
				spaceName, _ = s.spaces.SpaceName(ctx, ev.SpaceID)
			}
			if s.policy != nil {
				instance, _ = s.policy.PublicURL(ctx)
			}
		}
		if err := s.enqueueFor(ctx, h.ID, ev, spaceName, instance); err != nil {
			return err
		}
	}
	return nil
}

// enqueueFor takes the hook's next sequence number and queues the body.
func (s *Service) enqueueFor(ctx context.Context, hookID string, ev outgoingEvent, spaceName, instance string) error {
	seq, err := s.q.NextOutgoingSequence(ctx, hookID)
	if err != nil {
		return fmt.Errorf("next sequence: %w", err)
	}
	id := newID()
	body, err := json.Marshal(envelope{
		ID: id, Type: ev.Type, TS: s.now().UTC(), Instance: instance,
		Space: envelopeSpace{ID: ev.SpaceID, Name: spaceName}, Data: ev.Data,
	})
	if err != nil {
		return err
	}
	if err := s.queue.Enqueue(ctx, Item{ID: id, Lane: hookID, Event: ev.Type, Sequence: uint64(seq), Body: body}); err != nil {
		return err
	}
	s.wakeWorker()
	return nil
}

func wants(types []string, t string) bool {
	for _, x := range types {
		if x == t {
			return true
		}
	}
	return false
}

// subscriber watches the space topics of every space with an enabled
// outgoing hook. Topics are added as hooks are made and never removed:
// an event in a space with no hooks costs one indexed read.
type subscriber struct {
	mu  sync.Mutex
	sub *events.Subscription
}

// RunSubscriber consumes the bus until ctx ends. A dropped subscription
// (the consumer fell behind) is re-opened; the gap is what Stoop-Sequence
// makes visible.
func (s *Service) RunSubscriber(ctx context.Context) {
	if s.bus == nil || s.queue == nil {
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
				s.log.Error("enqueue hook delivery", "event", out.Type, "err", err)
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
			topics = append(topics, "space:"+h.SpaceID)
		}
	}
	return topics, nil
}

// watchSpace adds a space's topic to the live subscription, for a hook
// made after startup.
func (s *Service) watchSpace(spaceID string) {
	s.subs.mu.Lock()
	defer s.subs.mu.Unlock()
	if s.subs.sub != nil && !s.subs.sub.Has("space:"+spaceID) {
		s.subs.sub.Add("space:" + spaceID)
	}
}
