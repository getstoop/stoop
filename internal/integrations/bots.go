package integrations

import (
	"context"

	"connectrpc.com/connect"

	integrationsv1 "github.com/getstoop/stoop/gen/stoop/integrations/v1"
)

// The bot RPCs: the admin surface over auth's bot accounts. Bot tokens
// land with STOOP-266.

func (s *Service) ListBots(ctx context.Context, _ *connect.Request[integrationsv1.ListBotsRequest]) (*connect.Response[integrationsv1.ListBotsResponse], error) {
	if err := requireManage(ctx); err != nil {
		return nil, err
	}
	if err := s.ready(); err != nil {
		return nil, err
	}
	bots, err := s.bots.ListBots(ctx)
	if err != nil {
		return nil, err
	}
	creds, err := s.bots.Credentials(ctx, nil, nil)
	if err != nil {
		return nil, err
	}
	res := &integrationsv1.ListBotsResponse{}
	for _, b := range bots {
		res.Bots = append(res.Bots, toProtoBot(b, creds))
	}
	return connect.NewResponse(res), nil
}

func (s *Service) CreateBot(ctx context.Context, req *connect.Request[integrationsv1.CreateBotRequest]) (*connect.Response[integrationsv1.CreateBotResponse], error) {
	if err := requireManage(ctx); err != nil {
		return nil, err
	}
	if err := s.ready(); err != nil {
		return nil, err
	}
	bot, err := s.bots.CreateBot(ctx, req.Msg.Username, req.Msg.DisplayName)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&integrationsv1.CreateBotResponse{Bot: toProtoBot(bot, nil)}), nil
}

func (s *Service) UpdateBot(ctx context.Context, req *connect.Request[integrationsv1.UpdateBotRequest]) (*connect.Response[integrationsv1.UpdateBotResponse], error) {
	if err := requireManage(ctx); err != nil {
		return nil, err
	}
	if err := s.ready(); err != nil {
		return nil, err
	}
	bot, err := s.bots.RenameBot(ctx, req.Msg.Id, req.Msg.Username, req.Msg.DisplayName)
	if err != nil {
		return nil, err
	}
	creds, err := s.bots.Credentials(ctx, []string{bot.ID}, nil)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&integrationsv1.UpdateBotResponse{Bot: toProtoBot(bot, creds)}), nil
}

// DeactivateBot revokes the bot's credentials and disables its hooks.
func (s *Service) DeactivateBot(ctx context.Context, req *connect.Request[integrationsv1.DeactivateBotRequest]) (*connect.Response[integrationsv1.DeactivateBotResponse], error) {
	if err := requireManage(ctx); err != nil {
		return nil, err
	}
	if err := s.ready(); err != nil {
		return nil, err
	}
	if err := s.bots.DeactivateBot(ctx, req.Msg.Id); err != nil {
		return nil, err
	}
	return connect.NewResponse(&integrationsv1.DeactivateBotResponse{}), nil
}

func (s *Service) CreateBotToken(context.Context, *connect.Request[integrationsv1.CreateBotTokenRequest]) (*connect.Response[integrationsv1.CreateBotTokenResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) RevokeBotToken(context.Context, *connect.Request[integrationsv1.RevokeBotTokenRequest]) (*connect.Response[integrationsv1.RevokeBotTokenResponse], error) {
	return nil, errNotBuilt
}
