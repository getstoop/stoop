package integrations

import (
	"context"
	"fmt"

	"google.golang.org/protobuf/types/known/timestamppb"

	integrationsv1 "github.com/getstoop/stoop/gen/stoop/integrations/v1"
	"github.com/getstoop/stoop/internal/accesswire"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Wire shapes. Nothing here ever carries a token or a secret.

func toProtoIncoming(h dbgen.IncomingWebhook, cred *Credential) *integrationsv1.IncomingWebhook {
	out := &integrationsv1.IncomingWebhook{
		Id: h.ID, SpaceId: h.SpaceID, ChannelId: h.ChannelID, BotUserId: h.BotUserID, Name: h.Name,
		Enabled: h.DisabledAt == nil && h.CredentialID != nil, DisabledReason: h.DisabledReason,
		CreatedAt: timestamppb.New(h.CreatedAt),
	}
	if h.CredentialID == nil && h.DisabledReason == "" {
		out.DisabledReason = "its token was revoked"
	}
	if cred != nil {
		out.Permissions = accesswire.ToProto(cred.Grants)
		out.Hint = cred.Hint
		if cred.LastUsedAt != nil {
			out.LastUsedAt = timestamppb.New(*cred.LastUsedAt)
		}
	}
	return out
}

func (s *Service) protoIncoming(ctx context.Context, id string) (*integrationsv1.IncomingWebhook, error) {
	hook, err := s.incomingHook(ctx, id)
	if err != nil {
		return nil, err
	}
	list, err := s.protoIncomingList(ctx, []dbgen.IncomingWebhook{hook})
	if err != nil {
		return nil, err
	}
	return list[0], nil
}

// protoIncomingList joins each hook with its credential's grant and hint.
func (s *Service) protoIncomingList(ctx context.Context, hooks []dbgen.IncomingWebhook) ([]*integrationsv1.IncomingWebhook, error) {
	var ids []string
	for _, h := range hooks {
		if h.CredentialID != nil {
			ids = append(ids, *h.CredentialID)
		}
	}
	byID := map[string]*Credential{}
	if len(ids) > 0 {
		creds, err := s.bots.Credentials(ctx, nil, ids)
		if err != nil {
			return nil, fmt.Errorf("list hook credentials: %w", err)
		}
		for i := range creds {
			byID[creds[i].ID] = &creds[i]
		}
	}
	// A kick or a ban doesn't pass through this module, so the row can
	// still say on after the bot has gone; the sweep catches up, and the
	// list doesn't wait for it.
	in := map[string]bool{}
	out := make([]*integrationsv1.IncomingWebhook, len(hooks))
	for i, h := range hooks {
		var cred *Credential
		if h.CredentialID != nil {
			cred = byID[*h.CredentialID]
		}
		out[i] = toProtoIncoming(h, cred)
		if !out[i].Enabled {
			continue
		}
		key := h.SpaceID + "/" + h.BotUserID
		member, seen := in[key]
		if !seen {
			var err error
			if member, err = s.spaces.IsSpaceMember(ctx, h.BotUserID, h.SpaceID); err != nil {
				return nil, err
			}
			in[key] = member
		}
		if !member {
			out[i].Enabled = false
			out[i].DisabledReason = reasonBotRemoved
		}
	}
	return out, nil
}

func toProtoOutgoing(h dbgen.OutgoingWebhook) *integrationsv1.OutgoingWebhook {
	out := &integrationsv1.OutgoingWebhook{
		Id: h.ID, SpaceId: h.SpaceID, Name: h.Name, Url: h.Url, EventTypes: h.EventTypes,
		Enabled: h.DisabledAt == nil, DisabledReason: h.DisabledReason,
		CreatedAt: timestamppb.New(h.CreatedAt), Sequence: h.Sequence,
	}
	if h.ChannelID != nil {
		out.ChannelId = *h.ChannelID
	}
	return out
}

func toProtoDelivery(d dbgen.WebhookDelivery) *integrationsv1.Delivery {
	out := &integrationsv1.Delivery{
		Id: d.ID, WebhookId: d.Lane, EventType: d.EventType, Sequence: d.Sequence, Attempts: d.Attempts,
		Response: d.Response, Error: d.Error, CreatedAt: timestamppb.New(d.CreatedAt),
	}
	if d.StatusCode != nil {
		out.StatusCode = d.StatusCode
	}
	if d.FinishedAt != nil {
		out.FinishedAt = timestamppb.New(*d.FinishedAt)
	} else {
		out.NextAttemptAt = timestamppb.New(d.NotBefore)
	}
	return out
}

func toProtoBot(b Bot, creds []Credential, spaceIDs []string) *integrationsv1.Bot {
	out := &integrationsv1.Bot{
		Id: b.ID, Username: b.Username, DisplayName: b.DisplayName, AvatarFileId: b.AvatarFileID, Bio: b.Bio,
		CreatedAt: timestamppb.New(b.CreatedAt), SpaceIds: spaceIDs,
	}
	if b.DeactivatedAt != nil {
		out.DeactivatedAt = timestamppb.New(*b.DeactivatedAt)
	}
	for _, c := range creds {
		if c.HolderID == b.ID && c.Kind == "bot_token" {
			out.Tokens = append(out.Tokens, toProtoBotToken(c))
		}
	}
	return out
}

func toProtoBotToken(c Credential) *integrationsv1.BotToken {
	out := &integrationsv1.BotToken{
		Id: c.ID, BotUserId: c.HolderID, Name: c.Name, Permissions: accesswire.ToProto(c.Grants),
		CreatedAt: timestamppb.New(c.CreatedAt), Hint: c.Hint,
	}
	if c.LastUsedAt != nil {
		out.LastUsedAt = timestamppb.New(*c.LastUsedAt)
	}
	return out
}

// protoBot is a bot with its tokens and the spaces it is in.
func (s *Service) protoBot(ctx context.Context, b Bot, creds []Credential) (*integrationsv1.Bot, error) {
	spaceIDs, err := s.spaces.ListSpaceIDs(ctx, b.ID)
	if err != nil {
		return nil, fmt.Errorf("list bot spaces: %w", err)
	}
	return toProtoBot(b, creds, spaceIDs), nil
}
