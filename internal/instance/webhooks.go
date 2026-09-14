package instance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// The webhook settings, read by the integrations module through its
// Policy port. STOOP_WEBHOOKS=false is the floor under all three. See
// docs/proposals/webhooks.md → Instance policy.

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
	raw, err := s.q.GetSetting(ctx, key)
	if errors.Is(err, pgx.ErrNoRows) {
		return fallback, nil
	}
	if err != nil {
		return false, fmt.Errorf("read %s: %w", key, err)
	}
	var v bool
	if err := json.Unmarshal(raw, &v); err != nil {
		return false, fmt.Errorf("decode %s: %w", key, err)
	}
	return v, nil
}
