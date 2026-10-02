package auth

import "context"

// CountActiveAdmins reports how many non-deactivated instance admins exist.
func (s *Service) CountActiveAdmins(ctx context.Context) (int64, error) {
	return s.q.CountAdmins(ctx)
}
