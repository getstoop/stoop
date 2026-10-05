package instance

import (
	"context"
)

// The webhook settings, read by the integrations module through its
// Policy port. STOOP_WEBHOOKS=false is the floor under all three. See
// docs/architecture/integrations.md → Switches.

const (
	keyWebhooksIncoming            = "webhooks_incoming"
	keyWebhooksOutgoing            = "webhooks_outgoing"
	keyWebhooksAllowPrivateTargets = "webhooks_allow_private_targets"
)

// UseWebhooksEnv supplies STOOP_WEBHOOKS.
func (s *Service) UseWebhooksEnv(enabled bool) { s.webhooksEnv = enabled }

// WebhooksIncoming reports whether incoming hooks may post; on by default.
func (s *Service) WebhooksIncoming(ctx context.Context) (bool, error) {
	if !s.webhooksEnv {
		return false, nil
	}
	return s.readBool(ctx, keyWebhooksIncoming, true)
}

// WebhooksOutgoing reports whether outgoing hooks deliver; on by default.
func (s *Service) WebhooksOutgoing(ctx context.Context) (bool, error) {
	if !s.webhooksEnv {
		return false, nil
	}
	return s.readBool(ctx, keyWebhooksOutgoing, true)
}

// WebhooksAllowPrivateTargets reports whether outgoing hooks may reach
// private addresses; off by default.
func (s *Service) WebhooksAllowPrivateTargets(ctx context.Context) (bool, error) {
	return s.readBool(ctx, keyWebhooksAllowPrivateTargets, false)
}

// readBool decodes one JSON-boolean setting, returning fallback if unset.
func (s *Service) readBool(ctx context.Context, key string, fallback bool) (bool, error) {
	return readSettingOr(ctx, s, key, fallback)
}
