package auth

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	"github.com/Jhut89/stoop/internal/authctx"
)

// Password sign-in policy: whether the username/password form is for
// everyone, admins only, or nobody — so a server that has login providers
// can stop being a password store. The instance module owns the setting;
// auth consumes it through this port. Instance admins are always honoured
// (break-glass for a dead provider), and the CLI can flip the setting.

const (
	PasswordEveryone = "everyone"
	PasswordAdmins   = "admins"
	PasswordOff      = "off"
)

// PasswordPolicy is auth's port for the setting; backed by instance.
type PasswordPolicy interface {
	PasswordSignIn(ctx context.Context) (string, error)
}

// UsePasswordPolicy wires the port. Without it passwords are for everyone.
func (s *Service) UsePasswordPolicy(p PasswordPolicy) { s.passwords = p }

// passwordSignInAllowed says whether an account with this role may sign in
// (or be registered) with a password right now.
func (s *Service) passwordSignInAllowed(ctx context.Context, role authctx.Role) error {
	if s.passwords == nil || role == authctx.RoleAdmin {
		return nil
	}
	policy, err := s.passwords.PasswordSignIn(ctx)
	if err != nil {
		return err
	}
	if policy == PasswordEveryone || policy == "" {
		return nil
	}
	return connect.NewError(connect.CodePermissionDenied,
		errors.New("password sign-in is turned off on this server; use a login provider"))
}
