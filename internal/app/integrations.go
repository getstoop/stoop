package app

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/gen/stoop/chat/v1/chatv1connect"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/integrations"
)

// Adapters behind the integrations module's ports.

// hookPoster runs the credential gate the interceptor would have run,
// then calls chat's SendMessage with the hook's identity on ctx.
type hookPoster struct{ chat *chat.Service }

func (p hookPoster) Post(ctx context.Context, req integrations.PostRequest) (string, error) {
	id, ok := authctx.From(ctx)
	if !ok || !procedures[chatv1connect.ChatServiceSendMessageProcedure].CoveredBy(id.Credential) {
		return "", connect.NewError(connect.CodePermissionDenied, authctx.Uncovered(authctx.MessagesPost))
	}
	res, err := p.chat.SendMessage(ctx, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: req.ChannelID, Content: req.Content,
	}))
	if err != nil {
		return "", err
	}
	return res.Msg.Message.Id, nil
}

// botIdentities adapts auth's bot accounts onto the port.
type botIdentities struct{ auth *auth.Service }

func (b botIdentities) CreateBot(ctx context.Context, username, displayName string) (integrations.Bot, error) {
	bot, err := b.auth.CreateBot(ctx, username, displayName)
	return toIntegrationsBot(bot), err
}

func (b botIdentities) GetBot(ctx context.Context, id string) (integrations.Bot, error) {
	bot, err := b.auth.GetBot(ctx, id)
	return toIntegrationsBot(bot), err
}

func (b botIdentities) ListBots(ctx context.Context) ([]integrations.Bot, error) {
	bots, err := b.auth.ListBots(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]integrations.Bot, len(bots))
	for i, bot := range bots {
		out[i] = toIntegrationsBot(bot)
	}
	return out, nil
}

func (b botIdentities) UpdateBot(ctx context.Context, id string, username, displayName, bio *string) (integrations.Bot, error) {
	bot, err := b.auth.UpdateBot(ctx, id, username, displayName, bio)
	return toIntegrationsBot(bot), err
}

func (b botIdentities) DeactivateBot(ctx context.Context, id string) error {
	return b.auth.DeactivateBot(ctx, id)
}

func (b botIdentities) MintCredential(ctx context.Context, req integrations.MintRequest) (integrations.Credential, string, error) {
	cred, secret, err := b.auth.MintCredential(ctx, auth.MintBotCredential{
		HolderID: req.HolderID, Kind: req.Kind, Name: req.Name, Grants: req.Grants,
		ChannelID: req.ChannelID, CreatedBy: req.CreatedBy,
	})
	return toIntegrationsCredential(cred), secret, err
}

func (b botIdentities) SetCredentialGrants(ctx context.Context, id string, grants []authctx.Action) error {
	return b.auth.SetCredentialGrants(ctx, id, grants)
}

func (b botIdentities) RevokeCredential(ctx context.Context, id string) error {
	return b.auth.RevokeCredential(ctx, id)
}

func (b botIdentities) Credentials(ctx context.Context, holderIDs, ids []string) ([]integrations.Credential, error) {
	creds, err := b.auth.BotCredentials(ctx, holderIDs, ids)
	if err != nil {
		return nil, err
	}
	out := make([]integrations.Credential, len(creds))
	for i, c := range creds {
		out[i] = toIntegrationsCredential(c)
	}
	return out, nil
}

func (b botIdentities) CountCredentials(ctx context.Context, holderID string) (int64, error) {
	return b.auth.CountCredentials(ctx, holderID)
}

func (b botIdentities) VerifyHookToken(ctx context.Context, token string) (authctx.Identity, error) {
	if token == "" {
		return authctx.Identity{}, errors.New("missing token")
	}
	return b.auth.VerifyHookToken(ctx, token)
}

func toIntegrationsBot(b auth.Bot) integrations.Bot {
	return integrations.Bot{
		ID: b.ID, Username: b.Username, DisplayName: b.DisplayName, AvatarFileID: b.AvatarFileID, Bio: b.Bio,
		CreatedAt: b.CreatedAt, DeactivatedAt: b.DeactivatedAt,
	}
}

func toIntegrationsCredential(c auth.BotCredential) integrations.Credential {
	return integrations.Credential{
		ID: c.ID, HolderID: c.HolderID, Kind: c.Kind, Name: c.Name, Grants: c.Grants, Bounded: c.Bounded,
		SpaceIDs: c.SpaceIDs, ChannelIDs: c.ChannelIDs, Hint: c.Hint, CreatedAt: c.CreatedAt, LastUsedAt: c.LastUsedAt,
	}
}
