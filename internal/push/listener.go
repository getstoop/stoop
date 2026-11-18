package push

import (
	"context"
	"fmt"
	"slices"
	"sync"
	"time"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/events"
)

// The listener: activity items in, one delivery job per subscription out.
// It hears the personal topic of everyone with a subscription, the way
// the webhook subscriber hears the spaces that have hooks: the topics are
// read at start and added as people register, never removed. Every rule
// is checked here, when the item is heard; the job only sends. See
// docs/architecture/push-payload.md.

// deliveryTTL is how long a delivery is worth making: the push service
// keeps it no longer, and retries stop once it has passed.
const deliveryTTL = 24 * time.Hour

// listener holds the live subscription, so a registration can add its
// person's topic.
type listener struct {
	mu  sync.Mutex
	sub *events.Subscription
}

// RunListener hears the bus until ctx ends. A subscription dropped for
// falling behind is opened again; what was published meanwhile is not
// sent.
func (s *Service) RunListener(ctx context.Context) {
	if s.bus == nil || s.accounts == nil || s.jobs == nil {
		return
	}
	for ctx.Err() == nil {
		// Open first and add the topics after, so a registration made
		// while they are read is added to this subscription, not lost.
		sub := s.bus.Subscribe()
		s.listener.mu.Lock()
		s.listener.sub = sub
		s.listener.mu.Unlock()
		if err := s.watchRegistered(ctx, sub); err != nil {
			sub.Close()
			s.log.Warn("list push subscribers", "err", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
				continue
			}
		}
		s.hear(ctx, sub)
		sub.Close()
	}
}

func (s *Service) watchRegistered(ctx context.Context, sub *events.Subscription) error {
	users, err := s.q.ListPushUserIDs(ctx)
	if err != nil {
		return err
	}
	for _, userID := range users {
		sub.Add(events.UserTopic(userID))
	}
	return nil
}

// watchUser adds a person's topic to the live subscription, for a
// registration made after it opened.
func (s *Service) watchUser(userID string) {
	s.listener.mu.Lock()
	defer s.listener.mu.Unlock()
	if s.listener.sub != nil && !s.listener.sub.Has(events.UserTopic(userID)) {
		s.listener.sub.Add(events.UserTopic(userID))
	}
}

func (s *Service) hear(ctx context.Context, sub *events.Subscription) {
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-sub.Events():
			if !ok {
				s.log.Warn("push listener fell behind; resubscribing")
				return
			}
			created := ev.GetActivityItemCreated()
			if created == nil || created.GetItem() == nil || created.UserId == "" {
				continue
			}
			if err := s.itemHeard(ctx, created.UserId, created.Item); err != nil && ctx.Err() == nil {
				s.log.Error("queue push deliveries", "err", err)
			}
		}
	}
}

// itemHeard applies the rules, cheapest first, and queues one delivery
// per subscription that is left.
func (s *Service) itemHeard(ctx context.Context, userID string, item *chatv1.ActivityItem) error {
	if item.ReadAt != nil || item.Muted {
		return nil
	}
	if on, err := s.enabled(ctx); err != nil || !on {
		return err
	}
	if dnd, _, err := s.accounts.DoNotDisturb(ctx, userID); err != nil || dnd {
		return err
	}
	subs, err := s.q.ListPushSubscriptionsByUser(ctx, userID)
	if err != nil {
		return fmt.Errorf("list subscriptions: %w", err)
	}
	var wanted []string
	bySession := map[string]string{}
	for _, sub := range subs {
		if !slices.Contains(sub.Kinds, int32(item.Kind)) {
			continue
		}
		// The socket shows it; a silently dead one reads as open for
		// up to about 40 seconds, and that item is not pushed.
		if s.sockets != nil && s.sockets.SessionConnected(sub.CredentialID) {
			continue
		}
		wanted = append(wanted, sub.CredentialID)
		bySession[sub.CredentialID] = sub.ID
	}
	if len(wanted) == 0 {
		return nil
	}
	live, err := s.accounts.LiveSessions(ctx, wanted)
	if err != nil {
		return fmt.Errorf("check sessions: %w", err)
	}
	expires := s.now().Add(deliveryTTL)
	for _, sessionID := range live {
		subscriptionID, ok := bySession[sessionID]
		if !ok {
			continue
		}
		args := DeliveryArgs{SubscriptionID: subscriptionID, Expires: expires, Item: itemFacts(userID, item)}
		if _, err := s.jobs.Enqueue(ctx, DeliverPushKind, args); err != nil {
			return fmt.Errorf("queue push delivery: %w", err)
		}
	}
	return nil
}

// ItemFacts is what a delivery carries of the item: identifiers only.
// No message text or name is written to the jobs table; the job reads the
// actor and the preview as they are when it sends (Chat.PendingActivity).
type ItemFacts struct {
	UserID       string `json:"user_id"`
	ID           string `json:"id"`
	Kind         int32  `json:"kind"`
	SpaceID      string `json:"space_id"`
	ChannelID    string `json:"channel_id"`
	ThreadRootID string `json:"thread_root_id"`
	MessageID    string `json:"message_id"`
}

func itemFacts(userID string, item *chatv1.ActivityItem) ItemFacts {
	return ItemFacts{
		UserID: userID, ID: item.Id, Kind: int32(item.Kind),
		SpaceID: item.SpaceId, ChannelID: item.ChannelId, ThreadRootID: item.ThreadRootId, MessageID: item.MessageId,
	}
}

// actorName is who did it: their display name, else their username.
func actorName(actor *chatv1.MessageAuthor) string {
	if name := actor.GetDisplayName(); name != "" {
		return name
	}
	return actor.GetUsername()
}
