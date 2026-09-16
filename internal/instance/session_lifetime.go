package instance

import (
	"context"
	"time"
)

// The session_lifetime_days setting: how long a sign-in lasts. Read by
// auth through its SessionPolicy port when a session is made, so a change
// applies to sign-ins from then on.

const (
	keySessionLifetime = "session_lifetime_days"
	// MaxSessionLifetimeDays bounds both the setting and the environment.
	MaxSessionLifetimeDays = 365
)

// UseSessionLifetimeEnv supplies STOOP_SESSION_LIFETIME_DAYS, the
// fallback when nothing is saved.
func (s *Service) UseSessionLifetimeEnv(days int) { s.sessionDaysEnv = days }

// SessionLifetimeDays is the effective setting: saved, else environment,
// else 30.
func (s *Service) SessionLifetimeDays(ctx context.Context) (int, error) {
	var days int
	ok, err := s.readJSON(ctx, keySessionLifetime, &days)
	if err != nil {
		return 0, err
	}
	switch {
	case ok && days > 0:
		return days, nil
	case s.sessionDaysEnv > 0:
		return s.sessionDaysEnv, nil
	}
	return 30, nil
}

// SessionLifetime is the auth module's port.
func (s *Service) SessionLifetime(ctx context.Context) (time.Duration, error) {
	days, err := s.SessionLifetimeDays(ctx)
	return time.Duration(days) * 24 * time.Hour, err
}
