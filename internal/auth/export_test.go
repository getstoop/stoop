package auth

import "context"

// CountActiveAdmins reports how many non-deactivated instance admins exist.
func (s *Service) CountActiveAdmins(ctx context.Context) (int64, error) {
	return s.q.CountAdmins(ctx)
}

// SessionFor mints a session for userID, as a sign-in would, and returns
// its raw token.
func (s *Service) SessionFor(ctx context.Context, userID string) (string, error) {
	token, _, err := s.createSession(ctx, userID, "test")
	return token, err
}
