package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect"

	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/rowid"
)

// AccountSummary is what the instance module's user administration sees.
type AccountSummary struct {
	ID            string
	Username      string
	DisplayName   string
	Role          authctx.Role
	Kind          authctx.IdentityKind
	CreatedAt     time.Time
	DeactivatedAt *time.Time
	// DeletedAt: the person deleted the account. It stays deactivated.
	DeletedAt *time.Time
	// UsernameFrozen: an admin locked self-service renames.
	UsernameFrozen bool
	// HasPassword is false for a provider-created account with none yet.
	HasPassword bool
	// Self-described. An admin may read them to decide whether to clear
	// them, and clear them; never write them.
	Pronouns string
	Bio      string
	// PersonalTokens counts the account's personal tokens, expired ones included.
	PersonalTokens int
	// IsOwner: the server owner, whom no admin can demote, deactivate or
	// reset.
	IsOwner bool
}

// CountActiveAdmins reports how many non-deactivated instance admins exist.
func (s *Service) CountActiveAdmins(ctx context.Context) (int64, error) {
	return s.q.CountAdmins(ctx)
}

func (s *Service) ListAccounts(ctx context.Context) ([]AccountSummary, error) {
	rows, err := s.q.ListUsers(ctx)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	counts, err := s.q.CountPersonalTokensByHolder(ctx)
	if err != nil {
		return nil, fmt.Errorf("count tokens: %w", err)
	}
	byHolder := make(map[string]int, len(counts))
	for _, c := range counts {
		byHolder[c.HolderID] = int(c.N)
	}
	out := make([]AccountSummary, len(rows))
	for i, r := range rows {
		out[i] = toSummary(r)
		out[i].PersonalTokens = byHolder[r.ID]
	}
	return out, nil
}

// errOwner is the refusal that keeps the owner in charge whoever else is
// an admin.
var errOwner = connect.NewError(connect.CodeFailedPrecondition,
	errors.New("that's the server owner; they have to hand ownership to another admin first"))

// errLastAdmin is the refusal that keeps a server administrable.
var errLastAdmin = connect.NewError(connect.CodeFailedPrecondition,
	errors.New("that's the last active admin; promote someone else first"))

// SetAccountRole changes an account's instance role. A bot never holds
// the admin role: its reach is the spaces it has been put in, and the
// instance actions belong to a person's own token. A demotion runs under
// the admin guard.
func (s *Service) SetAccountRole(ctx context.Context, userID string, role authctx.Role) (AccountSummary, error) {
	if err := rowid.Require(userID, "user"); err != nil {
		return AccountSummary{}, err
	}
	if role == authctx.RoleMember {
		u, err := s.underAdminGuard(ctx, userID, func(qtx *dbgen.Queries) (dbgen.User, error) {
			return qtx.SetUserRole(ctx, dbgen.SetUserRoleParams{ID: userID, Role: string(role)})
		})
		if err != nil {
			return AccountSummary{}, err
		}
		return toSummary(u), nil
	}
	target, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return AccountSummary{}, apierr.NotFoundOr(err, "user")
	}
	if err := refuseBotTarget(target, "a bot can't be a server admin; a person's own token carries the server actions"); err != nil {
		return AccountSummary{}, err
	}
	u, err := s.q.SetUserRole(ctx, dbgen.SetUserRoleParams{ID: userID, Role: string(role)})
	if err != nil {
		return AccountSummary{}, apierr.NotFoundOr(err, "user")
	}
	return toSummary(u), nil
}

// SetAccountActive deactivates or reactivates an account. Deactivating
// runs under the admin guard and revokes every credential immediately;
// the row (and the user's messages) remain.
func (s *Service) SetAccountActive(ctx context.Context, userID string, active bool) (AccountSummary, error) {
	if err := rowid.Require(userID, "user"); err != nil {
		return AccountSummary{}, err
	}
	if active {
		if cur, err := s.q.GetUserByID(ctx, userID); err != nil {
			return AccountSummary{}, apierr.NotFoundOr(err, "user")
		} else if cur.DeletedAt != nil {
			return AccountSummary{}, connect.NewError(connect.CodeFailedPrecondition,
				errors.New("they deleted their account; it can't be brought back"))
		}
		u, err := s.q.SetUserDeactivated(ctx, dbgen.SetUserDeactivatedParams{ID: userID, Deactivated: false})
		if err != nil {
			return AccountSummary{}, apierr.NotFoundOr(err, "user")
		}
		return toSummary(u), nil
	}
	u, err := s.underAdminGuard(ctx, userID, func(qtx *dbgen.Queries) (dbgen.User, error) {
		return qtx.SetUserDeactivated(ctx, dbgen.SetUserDeactivatedParams{ID: userID, Deactivated: true})
	})
	if err != nil {
		return AccountSummary{}, err
	}
	if err := s.revokeAll(ctx, userID); err != nil {
		return AccountSummary{}, err
	}
	return toSummary(u), nil
}

// underAdminGuard runs a write that could remove an admin (a demotion, a
// deactivation) in one transaction with the count that decides whether
// it may: the roster lock makes the check and the write one step, so two
// admins demoting each other at once can't leave a server with none.
func (s *Service) underAdminGuard(ctx context.Context, targetID string, write func(qtx *dbgen.Queries) (dbgen.User, error)) (dbgen.User, error) {
	var written dbgen.User
	err := s.inTx(ctx, func(qtx *dbgen.Queries) error {
		if err := qtx.LockAdminRoster(ctx); err != nil {
			return fmt.Errorf("lock admin roster: %w", err)
		}
		target, err := qtx.GetUserByID(ctx, targetID)
		if err != nil {
			return apierr.NotFoundOr(err, "user")
		}
		if target.IsOwner {
			return errOwner
		}
		if authctx.Role(target.Role) == authctx.RoleAdmin && target.DeactivatedAt == nil {
			admins, err := qtx.CountAdmins(ctx)
			if err != nil {
				return fmt.Errorf("count admins: %w", err)
			}
			if admins <= 1 {
				return errLastAdmin
			}
		}
		written, err = write(qtx)
		if err != nil {
			return apierr.NotFoundOr(err, "user")
		}
		return nil
	})
	if err != nil {
		return dbgen.User{}, err
	}
	return written, nil
}

// RenameAccount changes an account's username and/or display name on an
// admin's behalf — same rules as the profile page's own rename.
func (s *Service) RenameAccount(ctx context.Context, userID string, username, displayName *string) (AccountSummary, error) {
	if err := rowid.Require(userID, "user"); err != nil {
		return AccountSummary{}, err
	}
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return AccountSummary{}, apierr.NotFoundOr(err, "user")
	}
	if username != nil {
		name := strings.ToLower(strings.TrimSpace(*username))
		if !usernameRE.MatchString(name) {
			return AccountSummary{}, apierr.Field(connect.CodeInvalidArgument, "username",
				errors.New("username must be 3-32 letters, numbers, or _"))
		}
		if reservedUsernames[name] {
			return AccountSummary{}, apierr.Field(connect.CodeInvalidArgument, "username",
				fmt.Errorf("%q is reserved; pick another username", name))
		}
		u, err = s.q.AdminSetUsername(ctx, dbgen.AdminSetUsernameParams{ID: userID, Username: name})
		if err != nil {
			if db.HasCode(err, db.UniqueViolation) {
				return AccountSummary{}, apierr.Field(connect.CodeAlreadyExists, "username",
					errors.New("username is taken"))
			}
			return AccountSummary{}, fmt.Errorf("update username: %w", err)
		}
	}
	if displayName != nil {
		name := strings.TrimSpace(*displayName)
		if name == "" || utf8.RuneCountInString(name) > maxDisplayNameLen {
			return AccountSummary{}, apierr.Field(connect.CodeInvalidArgument, "display_name",
				fmt.Errorf("display name must be 1-%d characters", maxDisplayNameLen))
		}
		u, err = s.q.UpdateUserProfile(ctx, dbgen.UpdateUserProfileParams{ID: userID, DisplayName: &name})
		if err != nil {
			return AccountSummary{}, fmt.Errorf("update display name: %w", err)
		}
	}
	return toSummary(u), nil
}

// ClearAccountProfile empties an account's pronouns and/or bio on an
// admin's behalf. It only ever writes the empty string: an admin needs to
// take down a slur, and nobody needs an admin authoring someone's
// self-description. Clearing neither is a no-op, not an error.
func (s *Service) ClearAccountProfile(ctx context.Context, userID string, pronouns, bio bool) (AccountSummary, error) {
	if err := rowid.Require(userID, "user"); err != nil {
		return AccountSummary{}, err
	}
	empty := ""
	arg := dbgen.UpdateUserProfileParams{ID: userID}
	if pronouns {
		arg.Pronouns = &empty
	}
	if bio {
		arg.Bio = &empty
	}
	u, err := s.q.UpdateUserProfile(ctx, arg)
	if err != nil {
		return AccountSummary{}, apierr.NotFoundOr(err, "user")
	}
	return toSummary(u), nil
}

// SetAccountUsernameFrozen locks or unlocks self-service renames on an
// account. Policy (no freezing admins) is enforced by the instance module.
func (s *Service) SetAccountUsernameFrozen(ctx context.Context, userID string, frozen bool) (AccountSummary, error) {
	if err := rowid.Require(userID, "user"); err != nil {
		return AccountSummary{}, err
	}
	target, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return AccountSummary{}, apierr.NotFoundOr(err, "user")
	}
	if err := refuseBotTarget(target, "a bot never renames itself, so there is nothing to freeze"); err != nil {
		return AccountSummary{}, err
	}
	u, err := s.q.SetUsernameFrozen(ctx, dbgen.SetUsernameFrozenParams{ID: userID, UsernameFrozen: frozen})
	if err != nil {
		return AccountSummary{}, apierr.NotFoundOr(err, "user")
	}
	return toSummary(u), nil
}

func toSummary(u dbgen.User) AccountSummary {
	return AccountSummary{
		ID: u.ID, Username: u.Username, DisplayName: u.DisplayName,
		Role: authctx.Role(u.Role), Kind: authctx.IdentityKind(u.Kind), CreatedAt: u.CreatedAt, DeactivatedAt: u.DeactivatedAt,
		DeletedAt:      u.DeletedAt,
		UsernameFrozen: u.UsernameFrozen,
		HasPassword:    u.PasswordHash != nil,
		Pronouns:       u.Pronouns,
		Bio:            u.Bio,
		IsOwner:        u.IsOwner,
	}
}

// SetRoleByUsername is the CLI recovery path (stoop admin promote/demote):
// SetAccountRole by name, with its refusals as plain sentences.
func (s *Service) SetRoleByUsername(ctx context.Context, username string, role authctx.Role) (AccountSummary, error) {
	u, err := s.q.GetUserByUsername(ctx, username)
	if err != nil {
		return AccountSummary{}, apierr.NotFoundOr(err, "user")
	}
	out, err := s.SetAccountRole(ctx, u.ID, role)
	var cerr *connect.Error
	if errors.As(err, &cerr) {
		return AccountSummary{}, errors.New(cerr.Message())
	}
	return out, err
}
