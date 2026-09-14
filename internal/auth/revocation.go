package auth

import (
	"context"
	"fmt"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/events"
)

// Revocation: every path that deletes a credential announces it on the
// bus, so the realtime gateway can close the sockets opened with it.

// UseBus wires the events bus. Without it revocations are silent and an
// open socket lives until its next request fails to verify.
func (s *Service) UseBus(bus events.Bus) { s.bus = bus }

// announceRevoked publishes CredentialRevoked to the holder's topic.
func (s *Service) announceRevoked(id, holderID string) {
	if s.bus == nil {
		return
	}
	s.bus.Publish("user:"+holderID, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_CredentialRevoked{
			CredentialRevoked: &realtimev1.CredentialRevoked{CredentialId: id},
		},
	}))
}

// revokeAll removes every credential an account holds: deactivation and
// an admin password reset.
func (s *Service) revokeAll(ctx context.Context, userID string) error {
	rows, err := s.q.DeleteUserCredentials(ctx, userID)
	if err != nil {
		return fmt.Errorf("revoke credentials: %w", err)
	}
	for _, r := range rows {
		s.announceRevoked(r.ID, r.HolderID)
	}
	return nil
}
