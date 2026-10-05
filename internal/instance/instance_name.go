package instance

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/config"
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

// stageInstanceName validates a save of the name, trimmed.
func stageInstanceName(_ context.Context, msg *instancev1.UpdateSettingsRequest, save *settingSave) error {
	if msg.InstanceName == nil {
		return nil
	}
	name := strings.TrimSpace(*msg.InstanceName)
	if name == "" {
		return apierr.Field(connect.CodeInvalidArgument, "instance_name", errors.New("the server name must not be blank"))
	}
	if utf8.RuneCountInString(name) > config.MaxInstanceNameRunes {
		return apierr.Field(connect.CodeInvalidArgument, "instance_name",
			fmt.Errorf("the server name must be %d characters or fewer", config.MaxInstanceNameRunes))
	}
	save.write(keyInstanceName, name)
	return nil
}
