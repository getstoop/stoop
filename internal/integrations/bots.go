package integrations

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	integrationsv1 "github.com/getstoop/stoop/gen/stoop/integrations/v1"
	"github.com/getstoop/stoop/internal/accesswire"
	"github.com/getstoop/stoop/internal/authctx"
)

// The bot RPCs: the admin surface over auth's bot accounts and their
// bearer tokens.

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

// CreateBotToken mints a bearer token for an existing bot. The secret is
// in the response and nowhere else.
func (s *Service) CreateBotToken(ctx context.Context, req *connect.Request[integrationsv1.CreateBotTokenRequest]) (*connect.Response[integrationsv1.CreateBotTokenResponse], error) {
	if err := requireManage(ctx); err != nil {
		return nil, err
	}
	if err := s.ready(); err != nil {
		return nil, err
	}
	bot, err := s.bots.GetBot(ctx, req.Msg.BotUserId)
	if err != nil {
		return nil, err
	}
	if bot.DeactivatedAt != nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("that bot is deactivated"))
	}
	grants, ok := accesswire.FromProto(req.Msg.Permissions)
	if !ok {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("unknown permission"))
	}
	cred, secret, err := s.bots.MintCredential(ctx, MintRequest{
		HolderID: bot.ID, Kind: authctx.CredentialBotToken, Name: req.Msg.Name, Grants: grants,
		Limited: req.Msg.Limited, SpaceIDs: req.Msg.SpaceIds, CreatedBy: authctx.UserID(ctx),
	})
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&integrationsv1.CreateBotTokenResponse{Token: toProtoBotToken(cred), Secret: secret}), nil
}

// RevokeBotToken revokes a bot token and retires a bot left with nothing.
func (s *Service) RevokeBotToken(ctx context.Context, req *connect.Request[integrationsv1.RevokeBotTokenRequest]) (*connect.Response[integrationsv1.RevokeBotTokenResponse], error) {
	if err := requireManage(ctx); err != nil {
		return nil, err
	}
	if err := s.ready(); err != nil {
		return nil, err
	}
	notFound := connect.NewError(connect.CodeNotFound, errors.New("token not found"))
	if _, err := uuid.Parse(req.Msg.TokenId); err != nil {
		return nil, notFound
	}
	creds, err := s.bots.Credentials(ctx, nil, []string{req.Msg.TokenId})
	if err != nil {
		return nil, err
	}
	if len(creds) != 1 || creds[0].Kind != authctx.CredentialBotToken {
		return nil, notFound
	}
	if err := s.bots.RevokeCredential(ctx, creds[0].ID); err != nil {
		return nil, err
	}
	if err := s.retireIfIdle(ctx, creds[0].HolderID); err != nil {
		return nil, err
	}
	return connect.NewResponse(&integrationsv1.RevokeBotTokenResponse{}), nil
}
