package instance

import (
	"context"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
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

func stageWebhooks(_ context.Context, msg *instancev1.UpdateSettingsRequest, save *settingSave) error {
	stageBool(save, keyWebhooksIncoming, msg.WebhooksIncoming)
	stageBool(save, keyWebhooksOutgoing, msg.WebhooksOutgoing)
	stageBool(save, keyWebhooksAllowPrivateTargets, msg.WebhooksAllowPrivateTargets)
	return nil
}
