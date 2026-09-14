package auth

import (
	"context"
	"fmt"
	"log/slog"
	"time"
)

// Credential hygiene: a session goes as soon as it expires; an expired
// personal token stays listed for expiredTokenKeep first.

const credentialSweepDelay = time.Minute

// SweepCredentials deletes expired credentials, and the legacy sessions
// rows that expired with them.
func (s *Service) SweepCredentials(ctx context.Context) (int64, error) {
	rows, err := s.q.SweepCredentials(ctx, time.Now().Add(-expiredTokenKeep))
	if err != nil {
		return 0, fmt.Errorf("sweep credentials: %w", err)
	}
	for _, r := range rows {
		s.announceRevoked(r.ID, r.HolderID)
	}
	return int64(len(rows)), nil
}

// RunCredentialSweeper sweeps on a timer until ctx ends: once shortly after
// start, then every interval. interval <= 0 disables.
func (s *Service) RunCredentialSweeper(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		return
	}
	run := func() {
		if _, err := s.SweepCredentials(ctx); err != nil && ctx.Err() == nil {
			slog.Default().Warn("credential sweep failed", "err", err)
		}
	}
	select {
	case <-ctx.Done():
		return
	case <-time.After(credentialSweepDelay):
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
