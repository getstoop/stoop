package auth

import (
	"context"
	"fmt"
	"time"
)

// Credential hygiene: a session goes as soon as it expires; an expired
// personal token stays listed for expiredTokenKeep first.

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

// SweepEmailTokens deletes email links a day past their expiry or use.
func (s *Service) SweepEmailTokens(ctx context.Context) (int64, error) {
	removed, err := s.q.SweepEmailTokens(ctx, time.Now().Add(-emailTokenKeep))
	if err != nil {
		return 0, fmt.Errorf("sweep email links: %w", err)
	}
	return removed, nil
}

const emailTokenKeep = 24 * time.Hour

// SweepCredentialsKind is the job kind internal/app registers for SweepCredentials.
const SweepCredentialsKind = "sweep_credentials"
