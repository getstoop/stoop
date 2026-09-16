// Package instance owns server-level state: whether the instance has been
// set up, admin-editable runtime settings (the registration policy), and
// user administration. It learns about users only through its UserAdmin
// port; the settings table is its own.
package instance

import (
	"sync/atomic"

	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/trustedproxy"
)

// UserSummary is what the instance module needs to know about an account.
type UserSummary struct {
	ID             string
	Username       string
	DisplayName    string
	Role           authctx.Role
	Kind           authctx.IdentityKind
	CreatedAt      time.Time
	DeactivatedAt  *time.Time
	DeletedAt      *time.Time
	UsernameFrozen bool
	HasPassword    bool
	Pronouns       string
	Bio            string
	PersonalTokens int
}

// UserAdmin is instance's port onto the auth module, wired in internal/app.
type UserAdmin interface {
	CountUsers(ctx context.Context) (int64, error)
	ListUsers(ctx context.Context) ([]UserSummary, error)
	// SetUserRole and SetUserActive refuse to demote or deactivate the
	// last active admin, atomically with the count that decides it.
	SetUserRole(ctx context.Context, userID string, role authctx.Role) (UserSummary, error)
	SetUserActive(ctx context.Context, userID string, active bool) (UserSummary, error)
	// ResetUserPassword sets a temporary password, revokes the account's
	// credentials, and returns the password (shown once).
	ResetUserPassword(ctx context.Context, userID string) (temporary string, user UserSummary, err error)
	// RenameUser changes the username and/or display name; nil leaves a
	// field unchanged.
	RenameUser(ctx context.Context, userID string, username, displayName *string) (UserSummary, error)
	// SetUsernameFrozen locks or unlocks self-service renames.
	SetUsernameFrozen(ctx context.Context, userID string, frozen bool) (UserSummary, error)
	// ClearUserProfile empties the pronouns and/or bio. It can only clear:
	// there is no admin path that writes either field.
	ClearUserProfile(ctx context.Context, userID string, pronouns, bio bool) (UserSummary, error)
	// ListUserTokens lists an account's personal tokens, never their secrets.
	ListUserTokens(ctx context.Context, userID string) ([]*authv1.PersonalToken, error)
	// RevokeUserToken revokes one of an account's personal tokens.
	RevokeUserToken(ctx context.Context, userID, tokenID string) error
}

type Service struct {
	q         *dbgen.Queries
	users     UserAdmin
	publicURL func() string
	env       ReachabilityEnv
	tailscale TailscaleController
	livekit   LiveKitReporter
	// loginEnv is the STOOP_OIDC_* fallback for login providers; a saved
	// list overrides it (providers.go).
	loginEnv []LoginProvider
	// passwordEnv is the STOOP_PASSWORD_SIGN_IN fallback (settings.go).
	passwordEnv string
	// instanceNameEnv is the STOOP_INSTANCE_NAME fallback, set from Seed's
	// Defaults. Empty unless the operator configured it (settings.go).
	instanceNameEnv string
	// sessionDaysEnv is STOOP_SESSION_LIFETIME_DAYS (session_lifetime.go).
	sessionDaysEnv int
	// webhooksEnv is STOOP_WEBHOOKS, the floor under the webhook settings.
	webhooksEnv bool
	// uploadCeiling is the files module's own hard per-file cap, wired in
	// internal/app. It bounds the max_upload_bytes setting (settings.go).
	uploadCeiling int64
	build         BuildInfo
	// trusted is read on every HTTP request (TrustsPeer), so it is kept
	// in memory and swapped on save rather than read from the database.
	trusted atomic.Pointer[trustedproxy.Set]
}

func New(pool *pgxpool.Pool, users UserAdmin) *Service {
	return &Service{q: dbgen.New(pool), users: users, publicURL: func() string { return "" }}
}

// UsePublicURL supplies the address reported in the instance status. A
// function because the built-in Tailscale listener only knows its address
// once it has joined the tailnet.
func (s *Service) UsePublicURL(fn func() string) {
	if fn != nil {
		s.publicURL = fn
	}
}

// requireAction is both gates for an action on the instance.
func requireAction(ctx context.Context, a authctx.Action) error {
	if !authctx.Holds(ctx, a) {
		return connect.NewError(connect.CodePermissionDenied,
			errors.New("instance admin role required"))
	}
	if !authctx.Covers(ctx, a) {
		return connect.NewError(connect.CodePermissionDenied, authctx.Refusal(ctx, a))
	}
	return nil
}
