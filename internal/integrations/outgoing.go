package integrations

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"slices"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	integrationsv1 "github.com/getstoop/stoop/gen/stoop/integrations/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/netguard"
	"github.com/getstoop/stoop/internal/rowid"
)

// Outgoing hooks: a URL they host, a signing secret, a set of event types
// and an optional channel filter. See docs/architecture/integrations.md → Outgoing.

const secretPrefix = "stp_whsec_"

func (s *Service) CreateOutgoing(ctx context.Context, req *connect.Request[integrationsv1.CreateOutgoingRequest]) (*connect.Response[integrationsv1.CreateOutgoingResponse], error) {
	if err := s.requireManageWired(ctx); err != nil {
		return nil, err
	}
	if err := s.requireOutgoing(ctx); err != nil {
		return nil, err
	}
	name, err := hookName(req.Msg.Name)
	if err != nil {
		return nil, err
	}
	if _, err := s.spaces.SpaceName(ctx, req.Msg.SpaceId); err != nil {
		return nil, err
	}
	channelID, err := s.filterChannel(ctx, req.Msg.SpaceId, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	types, err := eventTypes(req.Msg.EventTypes)
	if err != nil {
		return nil, err
	}
	target, err := s.checkTarget(ctx, req.Msg.Url)
	if err != nil {
		return nil, err
	}
	n, err := s.q.CountOutgoingWebhooksBySpace(ctx, req.Msg.SpaceId)
	if err != nil {
		return nil, fmt.Errorf("count hooks: %w", err)
	}
	if n >= maxHooksPerSpace {
		return nil, connect.NewError(connect.CodeResourceExhausted,
			fmt.Errorf("a space holds at most %d outgoing webhooks", maxHooksPerSpace))
	}
	secret, err := newSecret()
	if err != nil {
		return nil, err
	}
	row, err := s.q.CreateOutgoingWebhook(ctx, dbgen.CreateOutgoingWebhookParams{
		ID: rowid.New(), SpaceID: req.Msg.SpaceId, ChannelID: channelID, Url: target, Secret: []byte(secret),
		EventTypes: types, Name: name, CreatedBy: authctx.UserID(ctx),
	})
	if err != nil {
		return nil, fmt.Errorf("create hook: %w", err)
	}
	s.watchSpace(row.SpaceID)
	return connect.NewResponse(&integrationsv1.CreateOutgoingResponse{Webhook: toProtoOutgoing(row), Secret: secret}), nil
}

func (s *Service) UpdateOutgoing(ctx context.Context, req *connect.Request[integrationsv1.UpdateOutgoingRequest]) (*connect.Response[integrationsv1.UpdateOutgoingResponse], error) {
	if err := s.requireManageWired(ctx); err != nil {
		return nil, err
	}
	hook, err := s.outgoingHook(ctx, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	name, target, channelID, types := hook.Name, hook.Url, hook.ChannelID, hook.EventTypes
	if req.Msg.Name != nil {
		if name, err = hookName(*req.Msg.Name); err != nil {
			return nil, err
		}
	}
	if req.Msg.Url != nil {
		if target, err = s.checkTarget(ctx, *req.Msg.Url); err != nil {
			return nil, err
		}
	}
	if req.Msg.ChannelId != nil {
		if channelID, err = s.filterChannel(ctx, hook.SpaceID, *req.Msg.ChannelId); err != nil {
			return nil, err
		}
	}
	if req.Msg.SetEventTypes {
		if types, err = eventTypes(req.Msg.EventTypes); err != nil {
			return nil, err
		}
	}
	if err := s.q.UpdateOutgoingWebhook(ctx, dbgen.UpdateOutgoingWebhookParams{
		ID: hook.ID, Name: name, Url: target, ChannelID: channelID, EventTypes: types,
	}); err != nil {
		return nil, fmt.Errorf("update hook: %w", err)
	}
	if req.Msg.Enabled != nil {
		if *req.Msg.Enabled {
			err = s.q.EnableOutgoingWebhook(ctx, hook.ID)
		} else {
			err = s.q.DisableOutgoingWebhook(ctx, dbgen.DisableOutgoingWebhookParams{ID: hook.ID, DisabledReason: "turned off by an admin"})
		}
		if err != nil {
			return nil, fmt.Errorf("update hook: %w", err)
		}
	}
	hook, err = s.outgoingHook(ctx, hook.ID)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&integrationsv1.UpdateOutgoingResponse{Webhook: toProtoOutgoing(hook)}), nil
}

// TestWebhook queues a webhook.test delivery so the receiver's wiring can
// be checked without waiting for an event.
func (s *Service) TestWebhook(ctx context.Context, req *connect.Request[integrationsv1.TestWebhookRequest]) (*connect.Response[integrationsv1.TestWebhookResponse], error) {
	if err := s.requireManageWired(ctx); err != nil {
		return nil, err
	}
	if err := s.deliveriesWired(); err != nil {
		return nil, err
	}
	if err := s.requireOutgoing(ctx); err != nil {
		return nil, err
	}
	hook, err := s.outgoingHook(ctx, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	if hook.DisabledAt != nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("this webhook is disabled"))
	}
	spaceName, instance := s.envelopeNames(ctx, hook.SpaceID)
	ev := OutgoingEvent{Type: EventWebhookTest, SpaceID: hook.SpaceID, Data: rawJSON(map[string]any{}), At: s.now()}
	id := rowid.New()
	if err := db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		return s.enqueueFor(ctx, tx, id, hook.ID, ev, spaceName, instance)
	}); err != nil {
		return nil, err
	}
	delivery, err := s.q.GetDelivery(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("get delivery: %w", err)
	}
	return connect.NewResponse(&integrationsv1.TestWebhookResponse{Delivery: toProtoDelivery(delivery)}), nil
}

func (s *Service) ListDeliveries(ctx context.Context, req *connect.Request[integrationsv1.ListDeliveriesRequest]) (*connect.Response[integrationsv1.ListDeliveriesResponse], error) {
	if err := requireManage(ctx); err != nil {
		return nil, err
	}
	hook, err := s.outgoingHook(ctx, req.Msg.WebhookId)
	if err != nil {
		return nil, err
	}
	limit := req.Msg.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := s.q.ListDeliveriesByWebhook(ctx, dbgen.ListDeliveriesByWebhookParams{WebhookID: hook.ID, Limit: limit})
	if err != nil {
		return nil, fmt.Errorf("list deliveries: %w", err)
	}
	res := &integrationsv1.ListDeliveriesResponse{}
	for _, row := range rows {
		res.Deliveries = append(res.Deliveries, toProtoDelivery(row))
	}
	return connect.NewResponse(res), nil
}

// RedeliverDelivery re-queues a failed delivery's body under a new id.
// A delivered body was cleared on success and can't be sent again.
func (s *Service) RedeliverDelivery(ctx context.Context, req *connect.Request[integrationsv1.RedeliverDeliveryRequest]) (*connect.Response[integrationsv1.RedeliverDeliveryResponse], error) {
	if err := requireManage(ctx); err != nil {
		return nil, err
	}
	if err := s.deliveriesWired(); err != nil {
		return nil, err
	}
	if err := s.requireOutgoing(ctx); err != nil {
		return nil, err
	}
	if err := rowid.Require(req.Msg.DeliveryId, "delivery"); err != nil {
		return nil, err
	}
	dead, err := s.q.GetDelivery(ctx, req.Msg.DeliveryId)
	if err != nil {
		return nil, apierr.NotFoundOr(fmt.Errorf("get delivery: %w", err), "delivery")
	}
	if dead.FinishedAt == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("this delivery is still in progress"))
	}
	if dead.Body == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("this delivery succeeded; its body was not kept"))
	}
	hook, err := s.outgoingHook(ctx, dead.WebhookID)
	if err != nil {
		return nil, err
	}
	if hook.DisabledAt != nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("this webhook is disabled"))
	}
	id := rowid.New()
	args := DeliveryArgs{DeliveryID: id, HookID: dead.WebhookID, Event: dead.EventType, Sequence: dead.Sequence, Body: dead.Body}
	if err := db.InTx(ctx, s.pool, func(tx pgx.Tx) error { return s.queueDelivery(ctx, tx, args) }); err != nil {
		return nil, err
	}
	again, err := s.q.GetDelivery(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("get delivery: %w", err)
	}
	return connect.NewResponse(&integrationsv1.RedeliverDeliveryResponse{Delivery: toProtoDelivery(again)}), nil
}

// rotateOutgoing replaces the signing secret and returns the new one.
func (s *Service) rotateOutgoing(ctx context.Context, hook dbgen.OutgoingWebhook) (string, error) {
	secret, err := newSecret()
	if err != nil {
		return "", err
	}
	if err := s.q.SetOutgoingWebhookSecret(ctx, dbgen.SetOutgoingWebhookSecretParams{ID: hook.ID, Secret: []byte(secret)}); err != nil {
		return "", fmt.Errorf("rotate secret: %w", err)
	}
	return secret, nil
}

// deliveriesWired refuses what needs the job queue until it is wired.
func (s *Service) deliveriesWired() error {
	if s.jobs == nil {
		return connect.NewError(connect.CodeUnavailable, errors.New("deliveries are not wired"))
	}
	return nil
}

func (s *Service) requireOutgoing(ctx context.Context) error {
	on, err := s.policy.WebhooksOutgoing(ctx)
	if err != nil {
		return err
	}
	if !on {
		return connect.NewError(connect.CodeUnavailable, errors.New("outgoing webhooks are turned off on this server"))
	}
	return nil
}

// checkTarget validates the URL and refuses one the egress policy would
// never reach.
func (s *Service) checkTarget(ctx context.Context, raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || netguard.CheckURL(u) != nil {
		return "", apierr.Field(connect.CodeInvalidArgument, "url", errors.New("the URL must be an http or https address"))
	}
	allow, err := s.policy.WebhooksAllowPrivateTargets(ctx)
	if err != nil {
		return "", err
	}
	if err := (netguard.Policy{AllowPrivate: allow}).CheckHost(ctx, u); err != nil {
		if errors.Is(err, netguard.ErrNotPublic) {
			return "", apierr.Field(connect.CodeFailedPrecondition, "url",
				errors.New("that address is not allowed by this server's egress policy"))
		}
		return "", apierr.Field(connect.CodeInvalidArgument, "url", fmt.Errorf("the URL: %w", err))
	}
	return u.String(), nil
}

// filterChannel validates an optional channel filter within the space.
func (s *Service) filterChannel(ctx context.Context, spaceID, channelID string) (*string, error) {
	if channelID == "" {
		return nil, nil
	}
	got, err := s.spaces.ChannelSpace(ctx, channelID)
	if err != nil {
		return nil, err
	}
	if got != spaceID {
		return nil, apierr.Field(connect.CodeInvalidArgument, "channel_id", errors.New("that channel is in another space"))
	}
	return &channelID, nil
}

func eventTypes(raw []string) ([]string, error) {
	seen := map[string]bool{}
	var out []string
	for _, t := range raw {
		if !slices.Contains(EventTypes, t) {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("unknown event type %q", t))
		}
		if !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	if len(out) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("choose at least one event type"))
	}
	return out, nil
}

func newSecret() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return secretPrefix + base64.RawURLEncoding.EncodeToString(raw), nil
}

func (s *Service) outgoingHook(ctx context.Context, id string) (dbgen.OutgoingWebhook, error) {
	if err := rowid.Require(id, "webhook"); err != nil {
		return dbgen.OutgoingWebhook{}, err
	}
	hook, err := s.q.GetOutgoingWebhook(ctx, id)
	if err != nil {
		return dbgen.OutgoingWebhook{}, apierr.NotFoundOr(fmt.Errorf("get hook: %w", err), "webhook")
	}
	return hook, nil
}
