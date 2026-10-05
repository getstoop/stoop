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

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/rowid"
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
// inviteRequired reports that the invite is what admitted this sign-up,
// so a failed redemption later must undo the account (redeemInvite).
func (s *Service) checkRegistrationAllowed(ctx context.Context, inviteCode string, existingUsers int64) (inviteRequired bool, err error) {
	if existingUsers == 0 || s.policy == nil {
		return false, nil
	}
	// Instance admins may create accounts under any policy (the admin page
	// and dev seeding rely on this).
	if authctx.Allows(ctx, authctx.InstanceUsersManage) {
		return false, nil
	}
	policy, err := s.policy.RegistrationPolicy(ctx)
	if err != nil {
		return false, err
	}
	switch policy {
	case PolicyOpen:
		return false, nil
	case PolicyClosed:
		return false, connect.NewError(connect.CodePermissionDenied,
			errors.New("this server isn't accepting new accounts"))
	default: // invite
		if inviteCode == "" {
			return false, apierr.Field(connect.CodePermissionDenied, "invite_code",
				errors.New("an invite code is required to create an account on this server"))
		}
		if s.invites == nil {
			return false, connect.NewError(connect.CodeFailedPrecondition, errors.New("invites are not configured"))
		}
		return true, apierr.WithField(s.invites.ValidateInvite(ctx, inviteCode), "invite_code")
	}
}

// redeemInvite joins a just-created account to the invite's space. The
// invite is validated before the account exists and consumed after, so N
// concurrent sign-ups on a single-use code all pass validation and only
// one wins the consume. When the invite was what admitted the sign-up, the
// losers' accounts are removed again and the invite's refusal is returned;
// under an open policy a stale code is merely a missed join.
func (s *Service) redeemInvite(ctx context.Context, user dbgen.User, code string, required bool) (string, error) {
	spaceID, err := s.invites.RedeemInvite(ctx, code, user.ID)
	if err == nil {
		return spaceID, nil
	}
	if !required {
		slog.Warn("invite not redeemed after registration", "user_id", user.ID, "err", err)
		return "", nil
	}
	if derr := s.q.DeleteUser(ctx, user.ID); derr != nil {
		slog.Error("undo registration after spent invite", "user_id", user.ID, "err", derr)
	}
	return "", apierr.WithField(err, "invite_code")
}

func (s *Service) Register(ctx context.Context, req *connect.Request[authv1.RegisterRequest]) (*connect.Response[authv1.RegisterResponse], error) {
	// The handle is normalized to lowercase; the display name keeps the
	// capitalization the user typed (e.g. "Ada" → handle "ada").
	username := strings.ToLower(req.Msg.Username)
	if !usernameRE.MatchString(username) {
		return nil, apierr.Field(connect.CodeInvalidArgument, "username",
			errors.New("username must be 3-32 letters, numbers, or _"))
	}
	if reservedUsernames[username] {
		return nil, apierr.Field(connect.CodeInvalidArgument, "username",
			fmt.Errorf("%q is reserved; pick another username", username))
	}
	if len(req.Msg.Password) < 8 {
		return nil, apierr.Field(connect.CodeInvalidArgument, "password",
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
	inviteRequired, err := s.checkRegistrationAllowed(ctx, inviteCode, existing)
	if err != nil {
		return nil, err
	}
	// Password sign-up follows the password sign-in setting; the first
	// account (bootstrap) and admin-created accounts are exempt.
	if existing > 0 && !authctx.Allows(ctx, authctx.InstanceUsersManage) {
		err := s.passwordSignInAllowed(ctx, authctx.RoleMember)
		if connect.CodeOf(err) == connect.CodePermissionDenied {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("password sign-up is turned off on this server; use a login provider"))
		}
		if err != nil {
			return nil, fmt.Errorf("password sign-in policy: %w", err)
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
	if inviteCode != "" && s.invites != nil {
		spaceID, err := s.redeemInvite(ctx, user, inviteCode, inviteRequired)
		if err != nil {
			return nil, err
		}
		resp.JoinedSpaceId = spaceID
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
func (s *Service) createAccount(ctx context.Context, params createAccountParams) (dbgen.User, error) {
	id := rowid.New()
	var user dbgen.User
	err := s.inTx(ctx, func(qtx *dbgen.Queries) error {
		if err := qtx.LockUserBootstrap(ctx); err != nil {
			return fmt.Errorf("lock bootstrap: %w", err)
		}
		underLock, err := qtx.CountUsers(ctx)
		if err != nil {
			return fmt.Errorf("count users: %w", err)
		}
		role := authctx.RoleMember
		if underLock == 0 {
			role = authctx.RoleAdmin
		}

		user, err = qtx.CreateUser(ctx, dbgen.CreateUserParams{
			ID:              id,
			Username:        params.Username,
			DisplayName:     params.DisplayName,
			PasswordHash:    params.PasswordHash,
			Role:            string(role),
			UsernamePending: params.UsernamePending,
			// The first account, the server's first admin, owns it.
			IsOwner: underLock == 0,
		})
		if err != nil {
			if db.HasCode(err, db.UniqueViolation) {
				return apierr.Field(connect.CodeAlreadyExists, "username",
					errors.New("username is taken"))
			}
			return fmt.Errorf("create user: %w", err)
		}
		if params.Identity != nil {
			if _, err := qtx.CreateIdentity(ctx, dbgen.CreateIdentityParams{
				Provider: params.Identity.Provider,
				Subject:  params.Identity.Subject,
				UserID:   user.ID,
				Email:    params.Identity.Email,
			}); err != nil {
				return fmt.Errorf("create identity: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return dbgen.User{}, err
	}
	return user, nil
}
