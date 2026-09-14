package integrations

import (
	"context"

	"connectrpc.com/connect"

	integrationsv1 "github.com/getstoop/stoop/gen/stoop/integrations/v1"
)

// The bot RPCs. Behaviour lands with STOOP-259 (bots) and STOOP-266
// (bot tokens).

func (s *Service) ListBots(context.Context, *connect.Request[integrationsv1.ListBotsRequest]) (*connect.Response[integrationsv1.ListBotsResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) CreateBot(context.Context, *connect.Request[integrationsv1.CreateBotRequest]) (*connect.Response[integrationsv1.CreateBotResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) UpdateBot(context.Context, *connect.Request[integrationsv1.UpdateBotRequest]) (*connect.Response[integrationsv1.UpdateBotResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) DeactivateBot(context.Context, *connect.Request[integrationsv1.DeactivateBotRequest]) (*connect.Response[integrationsv1.DeactivateBotResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) CreateBotToken(context.Context, *connect.Request[integrationsv1.CreateBotTokenRequest]) (*connect.Response[integrationsv1.CreateBotTokenResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) RevokeBotToken(context.Context, *connect.Request[integrationsv1.RevokeBotTokenRequest]) (*connect.Response[integrationsv1.RevokeBotTokenResponse], error) {
	return nil, errNotBuilt
}
