package instance

import (
	"context"
)

// keyInstanceName: shown in the browser tab. Seeded from
// STOOP_INSTANCE_NAME, or with a random name when that is unset.
const keyInstanceName = "instance_name"

// UseInstanceNameEnv supplies STOOP_INSTANCE_NAME, for a process that
// doesn't run Seed (stoop admin).
func (s *Service) UseInstanceNameEnv(name string) { s.instanceNameEnv = name }

// InstanceName is the current setting: saved, else the environment, else
// "Stoop". The last only happens when the database was wiped under a
// running server (make dev-reset, the e2e harness): Seed picks the random
// name at boot, and nothing re-runs it until the next one.
func (s *Service) InstanceName(ctx context.Context) (string, error) {
	fallback := s.instanceNameEnv
	if fallback == "" {
		fallback = "Stoop"
	}
	return s.readSetting(ctx, keyInstanceName, fallback)
}
