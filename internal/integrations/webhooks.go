package integrations

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	integrationsv1 "github.com/getstoop/stoop/gen/stoop/integrations/v1"
)

// The hook RPCs. Behaviour lands with STOOP-259 (incoming), STOOP-260
// (outgoing) and STOOP-262 (the admin surface).

var errNotBuilt = connect.NewError(connect.CodeUnimplemented, errors.New("webhooks are not available yet"))

func (s *Service) ListWebhooks(context.Context, *connect.Request[integrationsv1.ListWebhooksRequest]) (*connect.Response[integrationsv1.ListWebhooksResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) CreateIncoming(context.Context, *connect.Request[integrationsv1.CreateIncomingRequest]) (*connect.Response[integrationsv1.CreateIncomingResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) CreateOutgoing(context.Context, *connect.Request[integrationsv1.CreateOutgoingRequest]) (*connect.Response[integrationsv1.CreateOutgoingResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) UpdateIncoming(context.Context, *connect.Request[integrationsv1.UpdateIncomingRequest]) (*connect.Response[integrationsv1.UpdateIncomingResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) UpdateOutgoing(context.Context, *connect.Request[integrationsv1.UpdateOutgoingRequest]) (*connect.Response[integrationsv1.UpdateOutgoingResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) DeleteWebhook(context.Context, *connect.Request[integrationsv1.DeleteWebhookRequest]) (*connect.Response[integrationsv1.DeleteWebhookResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) RotateSecret(context.Context, *connect.Request[integrationsv1.RotateSecretRequest]) (*connect.Response[integrationsv1.RotateSecretResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) TestWebhook(context.Context, *connect.Request[integrationsv1.TestWebhookRequest]) (*connect.Response[integrationsv1.TestWebhookResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) ListDeliveries(context.Context, *connect.Request[integrationsv1.ListDeliveriesRequest]) (*connect.Response[integrationsv1.ListDeliveriesResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) RedeliverDelivery(context.Context, *connect.Request[integrationsv1.RedeliverDeliveryRequest]) (*connect.Response[integrationsv1.RedeliverDeliveryResponse], error) {
	return nil, errNotBuilt
}
