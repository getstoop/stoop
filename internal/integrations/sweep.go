package integrations

import (
	"context"
	"fmt"
	"time"

	"github.com/getstoop/stoop/internal/authctx"
)

// A deleted channel or space cascades its hook rows but not their
// credentials, which live in auth's table. The sweep revokes those and
// retires bots left with nothing.

const sweepStartupDelay = 45 * time.Second

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

// RunSweeper sweeps orphaned hook credentials shortly after start and
// then every interval; 0 disables the timer.
func (s *Service) RunSweeper(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		return
	}
	run := func() {
		if n, err := s.SweepOrphanHooks(ctx); err != nil && ctx.Err() == nil {
			s.log.Warn("hook sweep failed", "err", err)
		} else if n > 0 {
			s.log.Info("revoked orphaned hook credentials", "count", n)
		}
	}
	select {
	case <-ctx.Done():
		return
	case <-time.After(sweepStartupDelay):
		run()
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			run()
		}
	}
}
