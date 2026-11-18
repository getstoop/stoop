package push

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/netguard"
	"github.com/getstoop/stoop/internal/webpush"
)

// One delivery: one activity item to one subscription, as a job. What the
// push service answers decides what happens to the row, and that is
// load-bearing for the relay: Gone (404, 410) deletes it; Retry (429,
// 5xx) tries again until the day is up; Rejected (anything else) is
// recorded and not tried again. Nothing but Gone deletes a row, however
// often it fails.

// DeliverPushKind is the job kind of one delivery.
const DeliverPushKind = "deliver_push"

// DeliveryBackoff is the wait before each retry, the last repeating; a
// longer Retry-After from the push service wins.
var DeliveryBackoff = []time.Duration{30 * time.Second, 2 * time.Minute, 10 * time.Minute, 30 * time.Minute, time.Hour}

// DeliveryAttempts is enough tries for the backoff to reach Expires: the
// day, not the count, is what ends a delivery.
const DeliveryAttempts = 40

// DeliveryArgs is one delivery, the job's arguments.
type DeliveryArgs struct {
	SubscriptionID string    `json:"subscription_id"`
	Expires        time.Time `json:"expires"`
	Item           ItemFacts `json:"item"`
}

// Verdict is what the job does next.
type Verdict struct {
	// Done: nothing more to do, sent or not.
	Done bool
	// RetryIn is the wait before the next try when not Done.
	RetryIn time.Duration
	// Failure is why, in words that name no endpoint, key or token.
	Failure string
}

// The reasons a delivery is recorded as failed, as Diagnostics shows them.
const (
	reasonRejected   = "push service refused it (%d)"
	reasonBusy       = "push service busy (%d)"
	reasonGaveUp     = "gave up after a day: %s"
	reasonBadAddress = "the device's address can't be used"
	reasonTooLarge   = "the notification was too large"
	reasonNotPublic  = "the device's address is not public"
	reasonNoAnswer   = "no answer from the push service"
)

// DeliverPush makes one attempt. An error is a failure before anything
// was posted (the database, the names), for the dispatcher's own retry.
func (s *Service) DeliverPush(ctx context.Context, args DeliveryArgs, attempt int) (Verdict, error) {
	sub, err := s.q.GetPushSubscription(ctx, args.SubscriptionID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Its session ended, or the push service said it was gone.
		return Verdict{Done: true}, nil
	}
	if err != nil {
		return Verdict{}, fmt.Errorf("load subscription: %w", err)
	}
	if !slices.Contains(sub.Kinds, args.Item.Kind) {
		// The device no longer wants this kind (empty means none).
		return Verdict{Done: true}, nil
	}
	now, err := s.stillWanted(ctx, sub.CredentialID, args.Item)
	if err != nil || now == nil {
		return Verdict{Done: err == nil}, err
	}
	remaining := args.Expires.Sub(s.now())
	if remaining < time.Second {
		return s.fail(ctx, sub, Verdict{Done: true, Failure: fmt.Sprintf(reasonGaveUp, "not sent in time")}), nil
	}
	payload, err := s.buildPayload(ctx, sub.LocalServerID, args.Item, now)
	if connect.CodeOf(err) == connect.CodeNotFound {
		// The channel went since: there is nothing to open.
		return Verdict{Done: true}, nil
	}
	if err != nil {
		return Verdict{}, err
	}
	sender, err := s.pushSender(ctx)
	if err != nil {
		return Verdict{}, err
	}
	result, err := sender.Send(ctx, webpush.Subscription{Endpoint: sub.Endpoint, P256DH: sub.P256dh, Auth: sub.Auth}, webpush.Message{
		Payload: payload, TTL: remaining.Truncate(time.Second), Topic: pushTopic(args.Item),
	})
	if err != nil {
		if ctx.Err() != nil {
			return Verdict{}, err
		}
		return s.fail(ctx, sub, unanswered(err, attempt, remaining)), nil
	}
	switch result.Outcome {
	case webpush.Accepted:
		if err := s.q.RecordPushSuccess(ctx, dbgen.RecordPushSuccessParams{ID: sub.ID, Endpoint: sub.Endpoint}); err != nil {
			s.log.Warn("record push success", "err", err)
		}
		return Verdict{Done: true}, nil
	case webpush.Gone:
		if err := s.q.DeleteGonePushSubscription(ctx, dbgen.DeleteGonePushSubscriptionParams{ID: sub.ID, Endpoint: sub.Endpoint}); err != nil {
			return Verdict{}, fmt.Errorf("delete gone subscription: %w", err)
		}
		return Verdict{Done: true}, nil
	case webpush.Retry:
		return s.fail(ctx, sub, retry(fmt.Sprintf(reasonBusy, result.Status), attempt, result.RetryAfter, remaining)), nil
	default:
		return s.fail(ctx, sub, Verdict{Done: true, Failure: fmt.Sprintf(reasonRejected, result.Status)}), nil
	}
}

// unanswered is the verdict on a post that got no answer: an address
// that can't be used is not tried again, anything else is.
func unanswered(err error, attempt int, remaining time.Duration) Verdict {
	switch {
	case errors.Is(err, netguard.ErrNotPublic):
		return Verdict{Done: true, Failure: reasonNotPublic}
	case errors.Is(err, webpush.ErrPayloadTooLarge):
		return Verdict{Done: true, Failure: reasonTooLarge}
	case errors.Is(err, webpush.ErrBadSubscription):
		return Verdict{Done: true, Failure: reasonBadAddress}
	}
	return retry(reasonNoAnswer, attempt, 0, remaining)
}

// retry waits the backoff for this attempt, or the push service's
// Retry-After when that is longer, and gives up when the wait would
// outlast the delivery's day or the attempts run out.
func retry(reason string, attempt int, retryAfter, remaining time.Duration) Verdict {
	wait := DeliveryBackoff[min(max(attempt-1, 0), len(DeliveryBackoff)-1)]
	wait = max(wait, retryAfter)
	if wait >= remaining || attempt >= DeliveryAttempts {
		return Verdict{Done: true, Failure: fmt.Sprintf(reasonGaveUp, reason)}
	}
	return Verdict{RetryIn: wait, Failure: reason}
}

// fail records the failed attempt on the row and hands the verdict on.
func (s *Service) fail(ctx context.Context, sub dbgen.GetPushSubscriptionRow, verdict Verdict) Verdict {
	if err := s.q.RecordPushFailure(ctx, dbgen.RecordPushFailureParams{
		ID: sub.ID, Endpoint: sub.Endpoint, Reason: verdict.Failure,
	}); err != nil {
		s.log.Warn("record push failure", "err", err)
	}
	return verdict
}

// stillWanted asks again, before every attempt, what may have changed
// since the item was heard: the session may have expired, and the item
// may have been read, deleted, replaced by a newer one under the same
// topic, muted, or put out of the recipient's reach. Each ends the
// delivery unsent and unrecorded: nothing failed.
func (s *Service) stillWanted(ctx context.Context, sessionID string, item ItemFacts) (*chatv1.ActivityItem, error) {
	if s.accounts == nil || s.chat == nil {
		return nil, errors.New("push is not wired")
	}
	live, err := s.accounts.LiveSessions(ctx, []string{sessionID})
	if err != nil {
		return nil, fmt.Errorf("check session: %w", err)
	}
	if !slices.Contains(live, sessionID) {
		return nil, nil
	}
	pending, err := s.chat.PendingActivity(ctx, item.UserID, item.ID)
	if err != nil {
		return nil, fmt.Errorf("check item: %w", err)
	}
	return pending, nil
}

// buildPayload fills the item's ids with what is read now: the actor and
// the preview as the feed shows them (now), the names and the waiting
// total. No message text is carried in the job.
func (s *Service) buildPayload(ctx context.Context, serverID string, item ItemFacts, now *chatv1.ActivityItem) ([]byte, error) {
	payload := Payload{
		V: PayloadVersion, ServerID: serverID,
		ItemID: item.ID, Kind: item.Kind, SpaceID: item.SpaceID, ChannelID: item.ChannelID,
		ThreadRootID: item.ThreadRootID, MessageID: item.MessageID,
		ActorName: actorName(now.GetActor()), Preview: now.GetPreview(),
	}
	if s.chat == nil {
		return nil, errors.New("push is not wired to chat")
	}
	var err error
	if payload.SpaceName, payload.ChannelName, err = s.chat.PlaceNames(ctx, item.ChannelID); err != nil {
		return nil, fmt.Errorf("place names: %w", err)
	}
	if payload.Waiting, err = s.chat.WaitingTotal(ctx, item.UserID); err != nil {
		return nil, fmt.Errorf("waiting total: %w", err)
	}
	return encodePayload(payload, payloadLimit), nil
}

// pushSender is the sender, made once with the signing key.
func (s *Service) pushSender(ctx context.Context) (*webpush.Sender, error) {
	s.senderMu.Lock()
	defer s.senderMu.Unlock()
	if s.sender != nil {
		return s.sender, nil
	}
	key, err := s.signingKey(ctx)
	if err != nil {
		return nil, err
	}
	// No operator contact is configured anywhere yet, so no sub claim.
	sender, err := webpush.NewSender(s.client, key, "")
	if err != nil {
		return nil, err
	}
	s.sender = sender
	return sender, nil
}
