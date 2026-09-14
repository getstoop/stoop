package integrations

import (
	"context"
	"errors"
	"strings"

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
		out, err := s.protoBot(ctx, b, creds)
		if err != nil {
			return nil, err
		}
		res.Bots = append(res.Bots, out)
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
	if bio := strings.TrimSpace(req.Msg.Bio); bio != "" {
		if bot, err = s.bots.UpdateBot(ctx, bot.ID, nil, nil, &bio); err != nil {
			return nil, err
		}
	}
	return connect.NewResponse(&integrationsv1.CreateBotResponse{Bot: toProtoBot(bot, nil, nil)}), nil
}

func (s *Service) UpdateBot(ctx context.Context, req *connect.Request[integrationsv1.UpdateBotRequest]) (*connect.Response[integrationsv1.UpdateBotResponse], error) {
	if err := requireManage(ctx); err != nil {
		return nil, err
	}
	if err := s.ready(); err != nil {
		return nil, err
	}
	bot, err := s.bots.UpdateBot(ctx, req.Msg.Id, req.Msg.Username, req.Msg.DisplayName, req.Msg.Bio)
	if err != nil {
		return nil, err
	}
	out, err := s.botWithTokens(ctx, bot)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&integrationsv1.UpdateBotResponse{Bot: out}), nil
}

// botWithTokens is one bot as ListBots would show it.
func (s *Service) botWithTokens(ctx context.Context, bot Bot) (*integrationsv1.Bot, error) {
	creds, err := s.bots.Credentials(ctx, []string{bot.ID}, nil)
	if err != nil {
		return nil, err
	}
	return s.protoBot(ctx, bot, creds)
}

// AddBotToSpace makes the bot a member of a space. This is the one path
// that widens where a bot's credentials work; bans hold.
func (s *Service) AddBotToSpace(ctx context.Context, req *connect.Request[integrationsv1.AddBotToSpaceRequest]) (*connect.Response[integrationsv1.AddBotToSpaceResponse], error) {
	bot, err := s.liveBot(ctx, req.Msg.BotUserId)
	if err != nil {
		return nil, err
	}
	if err := s.spaces.AddBotMember(ctx, req.Msg.SpaceId, bot.ID); err != nil {
		return nil, err
	}
	out, err := s.botWithTokens(ctx, bot)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&integrationsv1.AddBotToSpaceResponse{Bot: out}), nil
}

// RemoveBotFromSpace takes the bot out of a space as a kick would; its
// hooks there keep their configuration and stop posting.
func (s *Service) RemoveBotFromSpace(ctx context.Context, req *connect.Request[integrationsv1.RemoveBotFromSpaceRequest]) (*connect.Response[integrationsv1.RemoveBotFromSpaceResponse], error) {
	bot, err := s.liveBot(ctx, req.Msg.BotUserId)
	if err != nil {
		return nil, err
	}
	if err := s.spaces.RemoveBotMember(ctx, req.Msg.SpaceId, bot.ID); err != nil {
		return nil, err
	}
	out, err := s.botWithTokens(ctx, bot)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&integrationsv1.RemoveBotFromSpaceResponse{Bot: out}), nil
}

// liveBot is the gate and lookup the membership calls share.
func (s *Service) liveBot(ctx context.Context, id string) (Bot, error) {
	if err := requireManage(ctx); err != nil {
		return Bot{}, err
	}
	if err := s.ready(); err != nil {
		return Bot{}, err
	}
	bot, err := s.bots.GetBot(ctx, id)
	if err != nil {
		return Bot{}, err
	}
	if bot.DeactivatedAt != nil {
		return Bot{}, connect.NewError(connect.CodeFailedPrecondition, errors.New("that bot is deactivated"))
	}
	return bot, nil
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
