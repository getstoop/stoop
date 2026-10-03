package integrations

import (
	"context"
	"fmt"
	"time"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// A deleted channel or space cascades its hook rows but not their
// credentials, which live in auth's table. The sweep revokes those and
// retires bots left with nothing, and turns off the hooks of bots kicked
// or banned out of their space.

// SweepOrphanHooks revokes hook credentials no hook row points at and
// reports how many.
func (s *Service) SweepOrphanHooks(ctx context.Context) (int, error) {
	if s.bots == nil {
		return 0, nil
	}
	creds, err := s.bots.Credentials(ctx, nil, nil)
	if err != nil {
		return 0, err
	}
	hooks, err := s.q.ListIncomingWebhooks(ctx)
	if err != nil {
		return 0, fmt.Errorf("list hooks: %w", err)
	}
	live := map[string]bool{}
	for _, h := range hooks {
		if h.CredentialID != nil {
			live[*h.CredentialID] = true
		}
	}
	n := 0
	holders := map[string]bool{}
	for _, c := range creds {
		if c.Kind != authctx.CredentialIncomingHook || live[c.ID] {
			continue
		}
		if err := s.bots.RevokeCredential(ctx, c.ID); err != nil {
			return n, err
		}
		n++
		holders[c.HolderID] = true
	}
	for id := range holders {
		if err := s.retireIfIdle(ctx, id); err != nil {
			return n, err
		}
	}
	return n, nil
}

// SweepRemovedBotHooks turns off hooks whose bot has left the space by a
// path this module doesn't see (a kick, a ban) and reports how many.
func (s *Service) SweepRemovedBotHooks(ctx context.Context) (int, error) {
	if s.spaces == nil {
		return 0, nil
	}
	hooks, err := s.q.ListIncomingWebhooks(ctx)
	if err != nil {
		return 0, fmt.Errorf("list hooks: %w", err)
	}
	n := 0
	in := map[string]bool{}
	for _, h := range hooks {
		if h.DisabledAt != nil {
			continue
		}
		key := h.SpaceID + "/" + h.BotUserID
		member, seen := in[key]
		if !seen {
			if member, err = s.spaces.IsSpaceMember(ctx, h.BotUserID, h.SpaceID); err != nil {
				return n, err
			}
			in[key] = member
		}
		if member {
			continue
		}
		if err := s.q.DisableIncomingWebhook(ctx, dbgen.DisableIncomingWebhookParams{ID: h.ID, DisabledReason: reasonBotRemoved}); err != nil {
			return n, fmt.Errorf("disable hook: %w", err)
		}
		n++
	}
	return n, nil
}

// SweepDeliveries removes finished deliveries older than retention.
func (s *Service) SweepDeliveries(ctx context.Context, retention time.Duration) (int64, error) {
	if retention <= 0 {
		return 0, nil
	}
	n, err := s.q.SweepFinishedDeliveries(ctx, s.now().Add(-retention))
	if err != nil {
		return 0, fmt.Errorf("sweep deliveries: %w", err)
	}
	return n, nil
}

// SweepHooksKind is the job kind internal/app registers for the three hook sweeps.
const SweepHooksKind = "sweep_hooks"
