package instance

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/config"
)

// The session_lifetime_days setting: how long a sign-in lasts. Read by
// auth through its SessionPolicy port when a session is made, so a change
// applies to sign-ins from then on.

const keySessionLifetime = "session_lifetime_days"

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
	return config.DefaultSessionLifetimeDays, nil
}

// SessionLifetime is the auth module's port.
func (s *Service) SessionLifetime(ctx context.Context) (time.Duration, error) {
	days, err := s.SessionLifetimeDays(ctx)
	return time.Duration(days) * 24 * time.Hour, err
}

// stageSessionLifetime validates a save of session_lifetime_days.
func stageSessionLifetime(_ context.Context, msg *instancev1.UpdateSettingsRequest, save *settingSave) error {
	days := msg.SessionLifetimeDays
	if days == nil {
		return nil
	}
	if *days < 0 || *days > config.MaxSessionLifetimeDays {
		return apierr.Field(connect.CodeInvalidArgument, "session_lifetime_days",
			errors.New("a sign-in lasts 1-365 days, or 0 to use the server's default"))
	}
	save.write(keySessionLifetime, *days)
	return nil
}
