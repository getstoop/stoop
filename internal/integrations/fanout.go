package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/rowid"
)

// The fan-out: one job per event, in its space's lane, turns the event
// into a delivery per matching hook. See
// docs/architecture/integrations.md → Outgoing.

// FanOutWebhookEventKind is the job kind internal/app registers for
// fan-outs.
const FanOutWebhookEventKind = "fan_out_webhook_event"

// FanOutWebhookEvent writes a delivery row and queues a deliver_webhook
// job for every enabled hook in the space that wants the event, all in
// one transaction: a failure leaves nothing and the job's retry starts
// over. A hook that already has the event's delivery is skipped, so a
// fan-out run again after it committed queues nothing twice. With
// outgoing off nothing is written.
func (s *Service) FanOutWebhookEvent(ctx context.Context, ev OutgoingEvent) error {
	if s.jobs == nil {
		return nil
	}
	if on, err := s.policy.WebhooksOutgoing(ctx); err != nil || !on {
		return err
	}
	spaceName, instance := s.envelopeNames(ctx, ev.SpaceID)
	return db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		hooks, err := s.q.WithTx(tx).ListEnabledOutgoingWebhooksBySpace(ctx, ev.SpaceID)
		if err != nil {
			return fmt.Errorf("list hooks: %w", err)
		}
		for _, hook := range hooks {
			if !hookWants(hook, ev) {
				continue
			}
			id := eventDeliveryID(ev, hook.ID)
			done, err := s.deliveryExists(ctx, tx, id)
			if err != nil {
				return fmt.Errorf("hook %s: %w", hook.ID, err)
			}
			if done {
				continue
			}
			if err := s.enqueueFor(ctx, tx, id, hook.ID, ev, spaceName, instance); err != nil {
				return fmt.Errorf("hook %s: %w", hook.ID, err)
			}
		}
		return nil
	})
}

// eventDeliveryID is the event's delivery to the hook, derived from both
// so a second run of its fan-out finds it; random for an event without
// an id.
func eventDeliveryID(ev OutgoingEvent, hookID string) string {
	if ev.EventID == "" {
		return rowid.New()
	}
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("stoop:webhook-delivery:"+ev.EventID+":"+hookID)).String()
}

func (s *Service) deliveryExists(ctx context.Context, tx pgx.Tx, id string) (bool, error) {
	_, err := s.q.WithTx(tx).GetDelivery(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("get delivery: %w", err)
	}
	return true, nil
}

// envelopeNames is the space's name and the instance's URL for the body;
// either is empty when it cannot be read.
func (s *Service) envelopeNames(ctx context.Context, spaceID string) (spaceName, instance string) {
	if s.spaces != nil {
		spaceName, _ = s.spaces.SpaceName(ctx, spaceID)
	}
	instance, _ = s.policy.PublicURL(ctx)
	return spaceName, instance
}

// enqueueFor takes the hook's next sequence number, renders the body and
// queues the delivery id inside tx.
func (s *Service) enqueueFor(ctx context.Context, tx pgx.Tx, id, hookID string, ev OutgoingEvent, spaceName, instance string) error {
	sequence, err := s.q.WithTx(tx).NextOutgoingSequence(ctx, hookID)
	if err != nil {
		return fmt.Errorf("next sequence: %w", err)
	}
	body, err := json.Marshal(envelope{
		ID: id, Type: ev.Type, TS: ev.At.UTC(), Instance: instance,
		Space: envelopeSpace{ID: ev.SpaceID, Name: spaceName}, Data: ev.Data,
	})
	if err != nil {
		return err
	}
	return s.queueDelivery(ctx, tx, DeliveryArgs{DeliveryID: id, HookID: hookID, Event: ev.Type, Sequence: sequence, Body: body})
}

// queueDelivery writes the log row, queues its job in the hook's lane and
// puts the job's id on the row for the sweep, all inside tx.
func (s *Service) queueDelivery(ctx context.Context, tx pgx.Tx, args DeliveryArgs) error {
	queries := s.q.WithTx(tx)
	if err := queries.InsertDelivery(ctx, dbgen.InsertDeliveryParams{
		ID: args.DeliveryID, WebhookID: args.HookID, EventType: args.Event, Sequence: args.Sequence, Body: args.Body, Now: s.now(),
	}); err != nil {
		return fmt.Errorf("insert delivery: %w", err)
	}
	jobID, err := s.jobs.EnqueueInLaneTx(ctx, tx, DeliverWebhookKind, args, args.HookID, args.Sequence)
	if err != nil {
		return fmt.Errorf("queue delivery: %w", err)
	}
	if err := queries.SetDeliveryJob(ctx, dbgen.SetDeliveryJobParams{ID: args.DeliveryID, JobID: jobID}); err != nil {
		return fmt.Errorf("set delivery job: %w", err)
	}
	return nil
}
