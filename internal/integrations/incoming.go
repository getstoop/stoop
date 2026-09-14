package integrations

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	integrationsv1 "github.com/getstoop/stoop/gen/stoop/integrations/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Incoming hooks: a credential in a URL that posts into one channel as
// its bot. See docs/proposals/webhooks.md → Incoming.

const (
	maxHooksPerSpace = 20
	maxHookNameRunes = 50
	// reasonBotRemoved is why a hook is off once its bot has left the
	// space; a hook never widens where a bot works, so it can't post.
	reasonBotRemoved = "the bot was removed from this space"
)

func (s *Service) CreateIncoming(ctx context.Context, req *connect.Request[integrationsv1.CreateIncomingRequest]) (*connect.Response[integrationsv1.CreateIncomingResponse], error) {
	if err := requireManage(ctx); err != nil {
		return nil, err
	}
	if err := s.ready(); err != nil {
		return nil, err
	}
	if on, err := s.incomingEnabled(ctx); err != nil {
		return nil, err
	} else if !on {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("incoming webhooks are turned off on this server"))
	}
	name, err := hookName(req.Msg.Name)
	if err != nil {
		return nil, err
	}
	spaceID, err := s.spaces.ChannelSpace(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	n, err := s.q.CountIncomingWebhooksBySpace(ctx, spaceID)
	if err != nil {
		return nil, fmt.Errorf("count hooks: %w", err)
	}
	if n >= maxHooksPerSpace {
		return nil, connect.NewError(connect.CodeResourceExhausted,
			fmt.Errorf("a space holds at most %d incoming webhooks", maxHooksPerSpace))
	}

	// A hook never widens where a bot works: an existing bot must already
	// be in the space; a new bot is made a member of it, and nothing else.
	var bot Bot
	if req.Msg.BotUserId != "" {
		if bot, err = s.bots.GetBot(ctx, req.Msg.BotUserId); err != nil {
			return nil, err
		}
		if bot.DeactivatedAt != nil {
			return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("that bot is deactivated"))
		}
		member, err := s.spaces.IsSpaceMember(ctx, bot.ID, spaceID)
		if err != nil {
			return nil, err
		}
		if !member {
			return nil, connect.NewError(connect.CodeFailedPrecondition,
				errors.New("that bot isn't in this space; add it from Server admin → Integrations first"))
		}
	} else {
		if bot, err = s.newBotNamed(ctx, name); err != nil {
			return nil, err
		}
		if err := s.spaces.AddBotMember(ctx, spaceID, bot.ID); err != nil {
			return nil, err
		}
	}
	if req.Msg.NotifyEveryone {
		if err := s.spaces.SetBotAdmin(ctx, spaceID, bot.ID, true); err != nil {
			return nil, err
		}
	}
	cred, secret, err := s.bots.MintCredential(ctx, MintRequest{
		HolderID: bot.ID, Kind: authctx.CredentialIncomingHook, Name: name,
		Grants: hookGrants(req.Msg.NotifyEveryone), ChannelID: req.Msg.ChannelId, CreatedBy: authctx.UserID(ctx),
	})
	if err != nil {
		return nil, err
	}
	row, err := s.q.CreateIncomingWebhook(ctx, dbgen.CreateIncomingWebhookParams{
		ID: newID(), SpaceID: spaceID, ChannelID: req.Msg.ChannelId, BotUserID: bot.ID,
		CredentialID: &cred.ID, Name: name, CreatedBy: authctx.UserID(ctx),
	})
	if err != nil {
		_ = s.bots.RevokeCredential(ctx, cred.ID)
		return nil, fmt.Errorf("create hook: %w", err)
	}
	url, err := s.hookURL(ctx, secret)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&integrationsv1.CreateIncomingResponse{
		Webhook: toProtoIncoming(row, &cred), Url: url,
	}), nil
}

func (s *Service) UpdateIncoming(ctx context.Context, req *connect.Request[integrationsv1.UpdateIncomingRequest]) (*connect.Response[integrationsv1.UpdateIncomingResponse], error) {
	if err := requireManage(ctx); err != nil {
		return nil, err
	}
	if err := s.ready(); err != nil {
		return nil, err
	}
	hook, err := s.incomingHook(ctx, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	if req.Msg.Name != nil {
		name, err := hookName(*req.Msg.Name)
		if err != nil {
			return nil, err
		}
		if err := s.q.RenameIncomingWebhook(ctx, dbgen.RenameIncomingWebhookParams{ID: hook.ID, Name: name}); err != nil {
			return nil, fmt.Errorf("rename hook: %w", err)
		}
	}
	if req.Msg.NotifyEveryone != nil {
		if hook.CredentialID == nil {
			return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("this hook's token was revoked; rotate it first"))
		}
		if err := s.bots.SetCredentialGrants(ctx, *hook.CredentialID, hookGrants(*req.Msg.NotifyEveryone)); err != nil {
			return nil, err
		}
		if err := s.settleBotAdmin(ctx, hook.SpaceID, hook.BotUserID); err != nil {
			return nil, err
		}
	}
	if req.Msg.Enabled != nil {
		if *req.Msg.Enabled {
			if err := s.requireLiveBot(ctx, hook.BotUserID); err != nil {
				return nil, err
			}
			if err := s.requireBotInSpace(ctx, hook.BotUserID, hook.SpaceID); err != nil {
				return nil, err
			}
		}
		switch {
		case *req.Msg.Enabled && hook.CredentialID == nil:
			return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("this hook's token was revoked; rotate it to re-enable"))
		case *req.Msg.Enabled:
			err = s.q.SetIncomingWebhookCredential(ctx, dbgen.SetIncomingWebhookCredentialParams{ID: hook.ID, CredentialID: hook.CredentialID})
		default:
			err = s.q.DisableIncomingWebhook(ctx, dbgen.DisableIncomingWebhookParams{ID: hook.ID, DisabledReason: "turned off by an admin"})
		}
		if err != nil {
			return nil, fmt.Errorf("update hook: %w", err)
		}
	}
	out, err := s.protoIncoming(ctx, hook.ID)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&integrationsv1.UpdateIncomingResponse{Webhook: out}), nil
}

// deleteIncoming removes the hook and its credential, and deactivates a
// bot left with nothing.
func (s *Service) deleteIncoming(ctx context.Context, hook dbgen.IncomingWebhook) error {
	if _, err := s.q.DeleteIncomingWebhook(ctx, hook.ID); err != nil {
		return fmt.Errorf("delete hook: %w", err)
	}
	if hook.CredentialID != nil {
		if err := s.bots.RevokeCredential(ctx, *hook.CredentialID); err != nil && connect.CodeOf(err) != connect.CodeNotFound {
			return err
		}
	}
	return s.retireIfIdle(ctx, hook.BotUserID)
}

// rotateIncoming mints a new token with the old one's grant and revokes
// the old one.
func (s *Service) rotateIncoming(ctx context.Context, hook dbgen.IncomingWebhook) (string, error) {
	if err := s.requireLiveBot(ctx, hook.BotUserID); err != nil {
		return "", err
	}
	grants := hookGrants(false)
	if hook.CredentialID != nil {
		if creds, err := s.bots.Credentials(ctx, nil, []string{*hook.CredentialID}); err == nil && len(creds) == 1 {
			grants = creds[0].Grants
		}
	}
	cred, secret, err := s.bots.MintCredential(ctx, MintRequest{
		HolderID: hook.BotUserID, Kind: authctx.CredentialIncomingHook, Name: hook.Name,
		Grants: grants, ChannelID: hook.ChannelID, CreatedBy: authctx.UserID(ctx),
	})
	if err != nil {
		return "", err
	}
	if err := s.q.SetIncomingWebhookCredential(ctx, dbgen.SetIncomingWebhookCredentialParams{ID: hook.ID, CredentialID: &cred.ID}); err != nil {
		_ = s.bots.RevokeCredential(ctx, cred.ID)
		return "", fmt.Errorf("rotate hook: %w", err)
	}
	if hook.CredentialID != nil {
		if err := s.bots.RevokeCredential(ctx, *hook.CredentialID); err != nil && connect.CodeOf(err) != connect.CodeNotFound {
			return "", err
		}
	}
	return s.hookURL(ctx, secret)
}

// requireLiveBot refuses work on a hook whose bot is deactivated.
func (s *Service) requireLiveBot(ctx context.Context, botID string) error {
	bot, err := s.bots.GetBot(ctx, botID)
	if err != nil {
		return err
	}
	if bot.DeactivatedAt != nil {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("this hook's bot is deactivated; make a new hook"))
	}
	return nil
}

// requireBotInSpace refuses to turn a hook on while its bot is out of the
// space; adding the bot back is the admin's explicit act.
func (s *Service) requireBotInSpace(ctx context.Context, botID, spaceID string) error {
	member, err := s.spaces.IsSpaceMember(ctx, botID, spaceID)
	if err != nil {
		return err
	}
	if !member {
		return connect.NewError(connect.CodeFailedPrecondition,
			errors.New("the bot isn't in this space; add it back from Server admin → Integrations first"))
	}
	return nil
}

// disableHooksOfBotInSpace turns off the bot's incoming hooks in a space
// it has left, keeping their configuration for when it is back.
func (s *Service) disableHooksOfBotInSpace(ctx context.Context, spaceID, botID string) error {
	hooks, err := s.q.ListIncomingWebhooksBySpace(ctx, spaceID)
	if err != nil {
		return fmt.Errorf("list hooks: %w", err)
	}
	for _, h := range hooks {
		if h.BotUserID != botID || h.DisabledAt != nil {
			continue
		}
		if err := s.q.DisableIncomingWebhook(ctx, dbgen.DisableIncomingWebhookParams{ID: h.ID, DisabledReason: reasonBotRemoved}); err != nil {
			return fmt.Errorf("disable hook: %w", err)
		}
	}
	return nil
}

// retireIfIdle deactivates a bot that holds no credentials.
func (s *Service) retireIfIdle(ctx context.Context, botID string) error {
	n, err := s.bots.CountCredentials(ctx, botID)
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	return s.bots.DeactivateBot(ctx, botID)
}

// settleBotAdmin makes the bot a space admin while any of its hooks there
// may notify everyone, and a member once none may.
func (s *Service) settleBotAdmin(ctx context.Context, spaceID, botID string) error {
	hooks, err := s.q.ListIncomingWebhooksBySpace(ctx, spaceID)
	if err != nil {
		return fmt.Errorf("list hooks: %w", err)
	}
	var ids []string
	for _, h := range hooks {
		if h.BotUserID == botID && h.CredentialID != nil {
			ids = append(ids, *h.CredentialID)
		}
	}
	admin := false
	if len(ids) > 0 {
		creds, err := s.bots.Credentials(ctx, nil, ids)
		if err != nil {
			return err
		}
		for _, c := range creds {
			for _, g := range c.Grants {
				admin = admin || g == authctx.MessagesNotifyEveryone
			}
		}
	}
	return s.spaces.SetBotAdmin(ctx, spaceID, botID, admin)
}

// newBotNamed creates a bot for a hook, deriving a free username.
func (s *Service) newBotNamed(ctx context.Context, name string) (Bot, error) {
	base := botUsername(name)
	for i := 0; i < 20; i++ {
		username := base
		if i > 0 {
			username = fmt.Sprintf("%s_%d", base[:min(len(base), 29)], i+1)
		}
		bot, err := s.bots.CreateBot(ctx, username, name)
		if connect.CodeOf(err) == connect.CodeAlreadyExists {
			continue
		}
		return bot, err
	}
	return Bot{}, connect.NewError(connect.CodeAlreadyExists, errors.New("pick a different name; every username like it is taken"))
}

// botUsername derives a handle from a hook's name.
func botUsername(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '.':
			b.WriteRune('_')
		}
	}
	out := strings.Trim(b.String(), "_")
	for strings.Contains(out, "__") {
		out = strings.ReplaceAll(out, "__", "_")
	}
	if len(out) > 32 {
		out = out[:32]
	}
	if len(out) < 3 {
		out = strings.Trim(out+"_bot", "_")
	}
	return out
}

func hookGrants(notifyEveryone bool) []authctx.Action {
	if notifyEveryone {
		return []authctx.Action{authctx.MessagesPost, authctx.MessagesNotifyEveryone}
	}
	return []authctx.Action{authctx.MessagesPost}
}

func hookName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" || utf8.RuneCountInString(name) > maxHookNameRunes {
		return "", connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("a webhook's name must be 1-%d characters", maxHookNameRunes))
	}
	return name, nil
}

func (s *Service) hookURL(ctx context.Context, secret string) (string, error) {
	base := ""
	if s.policy != nil {
		var err error
		if base, err = s.policy.PublicURL(ctx); err != nil {
			return "", err
		}
	}
	return strings.TrimRight(base, "/") + "/hooks/" + secret, nil
}

func (s *Service) incomingHook(ctx context.Context, id string) (dbgen.IncomingWebhook, error) {
	if _, err := uuid.Parse(id); err != nil {
		return dbgen.IncomingWebhook{}, connect.NewError(connect.CodeNotFound, errors.New("webhook not found"))
	}
	hook, err := s.q.GetIncomingWebhook(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return dbgen.IncomingWebhook{}, connect.NewError(connect.CodeNotFound, errors.New("webhook not found"))
	}
	if err != nil {
		return dbgen.IncomingWebhook{}, fmt.Errorf("get hook: %w", err)
	}
	return hook, nil
}

func newID() string {
	id, err := uuid.NewV7()
	if err != nil {
		panic(err)
	}
	return id.String()
}
