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

// lostAfter is how old an unfinished delivery must be before the sweep
// asks about its job: a younger one may simply not have run yet.
const lostAfter = 5 * time.Minute

// SweepLostDeliveries finishes unfinished deliveries whose job is
// discarded or gone, or that never got one, as dead with the reason, and
// reports how many.
func (s *Service) SweepLostDeliveries(ctx context.Context) (int64, error) {
	if s.jobs == nil {
		return 0, nil
	}
	rows, err := s.q.ListUnfinishedDeliveriesBefore(ctx, s.now().Add(-lostAfter))
	if err != nil {
		return 0, fmt.Errorf("list unfinished deliveries: %w", err)
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		if row.JobID != nil {
			ids = append(ids, *row.JobID)
		}
	}
	statuses, err := s.jobs.JobStatuses(ctx, ids)
	if err != nil {
		return 0, err
	}
	var finished int64
	for _, row := range rows {
		reason, lost := lostReason(row.JobID, statuses)
		if !lost {
			continue
		}
		count, err := s.q.FinishLostDelivery(ctx, dbgen.FinishLostDeliveryParams{ID: row.ID, Now: s.now(), Error: reason})
		if err != nil {
			return finished, fmt.Errorf("finish lost delivery: %w", err)
		}
		finished += count
	}
	return finished, nil
}

// lostReason says why a delivery's job will never finish it, or false
// while the job may still.
func lostReason(jobID *string, statuses map[string]JobStatus) (string, bool) {
	if jobID == nil {
		return "no job was queued for it", true
	}
	status, found := statuses[*jobID]
	switch {
	case !found:
		return "its job is gone", true
	case !status.Discarded:
		return "", false
	case status.Error != "":
		return "its job was discarded: " + status.Error, true
	default:
		return "its job was discarded", true
	}
}

// SweepHooksKind is the job kind internal/app registers for the hook sweeps.
const SweepHooksKind = "sweep_hooks"
