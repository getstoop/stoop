package instance

import (
	"context"
	"fmt"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
)

// keyPasswordSignIn: who may use the username/password form. Seeded
// from STOOP_PASSWORD_SIGN_IN (seed_env.go).
const keyPasswordSignIn = "password_sign_in"

// PasswordSignIn is who may sign in (and register) with a password; the
// auth module consumes it as a string through its PasswordPolicy port.
type PasswordSignIn string

const (
	PasswordEveryone PasswordSignIn = "everyone"
	PasswordAdmins   PasswordSignIn = "admins"
	PasswordOff      PasswordSignIn = "off"
)

var passwordSignIns = newEnumSetting(map[PasswordSignIn]instancev1.PasswordSignIn{
	PasswordEveryone: instancev1.PasswordSignIn_PASSWORD_SIGN_IN_EVERYONE,
	PasswordAdmins:   instancev1.PasswordSignIn_PASSWORD_SIGN_IN_ADMINS,
	PasswordOff:      instancev1.PasswordSignIn_PASSWORD_SIGN_IN_OFF,
}, instancev1.PasswordSignIn_PASSWORD_SIGN_IN_EVERYONE)

// UsePasswordSignInEnv supplies STOOP_PASSWORD_SIGN_IN.
func (s *Service) UsePasswordSignInEnv(v string) { s.passwordEnv = v }

// PasswordSignIn is the setting in force: saved, else environment, else
// everyone. Also the auth module's port.
func (s *Service) PasswordSignIn(ctx context.Context) (string, error) {
	fallback := s.passwordEnv
	if fallback == "" {
		fallback = string(PasswordEveryone)
	}
	return s.readSetting(ctx, keyPasswordSignIn, fallback)
}

// SetPasswordSignIn writes the setting without the provider guard — the
// CLI's break-glass (`stoop admin password-login everyone`).
func (s *Service) SetPasswordSignIn(ctx context.Context, value PasswordSignIn) error {
	if !passwordSignIns.has(value) {
		return fmt.Errorf("password sign-in must be everyone, admins, or off (got %q)", value)
	}
	return s.writeSettings(ctx, []settingWrite{{keyPasswordSignIn, value}})
}
