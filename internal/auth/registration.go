package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"

	"connectrpc.com/connect"
	"github.com/alexedwards/argon2id"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

var usernameRE = regexp.MustCompile(`^[a-z0-9_]{3,32}$`)

// reservedUsernames can't be registered: they're mention keywords or would
// be confusing as handles.
var reservedUsernames = map[string]bool{
	"everyone": true, "here": true, "channel": true, "all": true,
	"admin": true, "stoop": true, "system": true,
}

// Registration policies as the auth module understands them; the instance
// module stores and exposes the same strings.
const (
	PolicyOpen   = "open"
	PolicyInvite = "invite"
	PolicyClosed = "closed"
)

// RegistrationPolicy is auth's port for the instance setting; backed by the
// instance module, wired in internal/app.
type RegistrationPolicy interface {
	RegistrationPolicy(ctx context.Context) (string, error)
}

// InviteRedeemer is auth's port onto the chat module: validate a code before
// an account is created, then redeem it (join the space) afterwards.
type InviteRedeemer interface {
	ValidateInvite(ctx context.Context, code string) error
	RedeemInvite(ctx context.Context, code, userID string) (spaceID string, err error)
}

// UseRegistrationPorts wires the policy and invite ports. Set once at
// startup; without them registration behaves as "open" with no invites.
func (s *Service) UseRegistrationPorts(policy RegistrationPolicy, invites InviteRedeemer) {
	s.policy = policy
	s.invites = invites
}

// checkRegistrationAllowed applies the policy to a registration attempt.
// The first account on a fresh instance is always allowed (bootstrap).
func (s *Service) checkRegistrationAllowed(ctx context.Context, inviteCode string, existingUsers int64) error {
	if existingUsers == 0 || s.policy == nil {
		return nil
	}
	// Instance admins may create accounts under any policy (the admin page
	// and dev seeding rely on this).
	if authctx.IsAdmin(ctx) {
		return nil
	}
	policy, err := s.policy.RegistrationPolicy(ctx)
	if err != nil {
		return err
	}
	switch policy {
	case PolicyOpen:
		return nil
	case PolicyClosed:
		return connect.NewError(connect.CodePermissionDenied,
			errors.New("this server isn't accepting new accounts"))
	default: // invite
		if inviteCode == "" {
			return connect.NewError(connect.CodePermissionDenied,
				errors.New("an invite code is required to create an account on this server"))
		}
		if s.invites == nil {
			return connect.NewError(connect.CodeFailedPrecondition, errors.New("invites are not configured"))
		}
		return s.invites.ValidateInvite(ctx, inviteCode)
	}
}

func (s *Service) Register(ctx context.Context, req *connect.Request[authv1.RegisterRequest]) (*connect.Response[authv1.RegisterResponse], error) {
	// The handle is normalized to lowercase; the display name keeps the
	// capitalization the user typed (e.g. "Ada" → handle "ada").
	username := strings.ToLower(req.Msg.Username)
	if !usernameRE.MatchString(username) {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("username must be 3-32 letters, numbers, or _"))
	}
	if reservedUsernames[username] {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("%q is reserved; pick another username", username))
	}
	if len(req.Msg.Password) < 8 {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("password must be at least 8 characters"))
	}

	// Policy check before the expensive hash. The count here is only for the
	// bootstrap exemption; the authoritative count for the admin role is
	// taken again under the lock below.
	inviteCode := strings.TrimSpace(req.Msg.InviteCode)
	existing, err := s.q.CountUsers(ctx)
	if err != nil {
		return nil, fmt.Errorf("count users: %w", err)
	}
	if err := s.checkRegistrationAllowed(ctx, inviteCode, existing); err != nil {
		return nil, err
	}
	// Password sign-up follows the password sign-in setting; the first
	// account (bootstrap) and admin-created accounts are exempt.
	if existing > 0 && !authctx.IsAdmin(ctx) {
		if err := s.passwordSignInAllowed(ctx, authctx.RoleMember); err != nil {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("password sign-up is turned off on this server; use a login provider"))
		}
	}

	hash, err := argon2id.CreateHash(req.Msg.Password, s.argon2)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	user, err := s.createAccount(ctx, createAccountParams{
		Username:     username,
		DisplayName:  req.Msg.Username,
		PasswordHash: &hash,
	})
	if err != nil {
		return nil, err
	}

	resp := &authv1.RegisterResponse{User: toProtoUser(user)}
	// Redeem after the account exists. If the code was exhausted in the
	// meantime the account still stands; the user just isn't in the space
	// and can try another code once logged in.
	if inviteCode != "" && s.invites != nil {
		spaceID, err := s.invites.RedeemInvite(ctx, inviteCode, user.ID)
		if err != nil {
			slog.Warn("invite not redeemed after registration", "user_id", user.ID, "err", err)
		} else {
			resp.JoinedSpaceId = spaceID
		}
	}
	return connect.NewResponse(resp), nil
}

// createAccountParams describes the row createAccount inserts. Username
// must already be validated and lowercased.
type createAccountParams struct {
	Username    string
	DisplayName string
	// Nil for an account created via a login provider (no password yet).
	PasswordHash *string
	// True when the username was derived from a provider claim; the owner
	// may rename once via UpdateProfile.
	UsernamePending bool
	// Identity, when set, is inserted in the same transaction so a
	// provider sign-up can never leave an account without its identity.
	Identity *identitySeed
}

type identitySeed struct {
	Provider, Subject, Email string
}

// createAccount inserts the user (and optional identity) in one
// transaction. The first account on a fresh instance becomes the admin:
// the count and insert run under an advisory lock so two simultaneous
// first registrations can't both observe an empty table.
func (s *Service) createAccount(ctx context.Context, p createAccountParams) (dbgen.User, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return dbgen.User{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return dbgen.User{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op

	qtx := s.q.WithTx(tx)
	if err := qtx.LockUserBootstrap(ctx); err != nil {
		return dbgen.User{}, fmt.Errorf("lock bootstrap: %w", err)
	}
	underLock, err := qtx.CountUsers(ctx)
	if err != nil {
		return dbgen.User{}, fmt.Errorf("count users: %w", err)
	}
	role := authctx.RoleMember
	if underLock == 0 {
		role = authctx.RoleAdmin
	}

	user, err := qtx.CreateUser(ctx, dbgen.CreateUserParams{
		ID:              id.String(),
		Username:        p.Username,
		DisplayName:     p.DisplayName,
		PasswordHash:    p.PasswordHash,
		Role:            string(role),
		UsernamePending: p.UsernamePending,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return dbgen.User{}, connect.NewError(connect.CodeAlreadyExists,
				errors.New("username is taken"))
		}
		return dbgen.User{}, fmt.Errorf("create user: %w", err)
	}
	if p.Identity != nil {
		if _, err := qtx.CreateIdentity(ctx, dbgen.CreateIdentityParams{
			Provider: p.Identity.Provider,
			Subject:  p.Identity.Subject,
			UserID:   user.ID,
			Email:    p.Identity.Email,
		}); err != nil {
			return dbgen.User{}, fmt.Errorf("create identity: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return dbgen.User{}, fmt.Errorf("commit: %w", err)
	}
	return user, nil
}
