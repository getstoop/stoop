package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
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

// errLastAdmin is the refusal that keeps a server administrable.
var errLastAdmin = connect.NewError(connect.CodeFailedPrecondition,
	errors.New("that's the last active admin; promote someone else first"))

// SetAccountRole changes an account's instance role. A bot never holds
// the admin role: its reach is the spaces it has been put in, and the
// instance actions belong to a person's own token. A demotion runs under
// the admin guard.
func (s *Service) SetAccountRole(ctx context.Context, userID string, role authctx.Role) (AccountSummary, error) {
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
		return AccountSummary{}, notFoundOr(err, "user")
	}
	if err := refuseBotTarget(target, "a bot can't be a server admin; a person's own token carries the server actions"); err != nil {
		return AccountSummary{}, err
	}
	u, err := s.q.SetUserRole(ctx, dbgen.SetUserRoleParams{ID: userID, Role: string(role)})
	if err != nil {
		return AccountSummary{}, notFoundOr(err, "user")
	}
	return toSummary(u), nil
}

// SetAccountActive deactivates or reactivates an account. Deactivating
// runs under the admin guard and revokes every credential immediately;
// the row (and the user's messages) remain.
func (s *Service) SetAccountActive(ctx context.Context, userID string, active bool) (AccountSummary, error) {
	if active {
		u, err := s.q.SetUserDeactivated(ctx, dbgen.SetUserDeactivatedParams{ID: userID, Deactivated: false})
		if err != nil {
			return AccountSummary{}, notFoundOr(err, "user")
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
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return dbgen.User{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
	qtx := s.q.WithTx(tx)
	if err := qtx.LockAdminRoster(ctx); err != nil {
		return dbgen.User{}, fmt.Errorf("lock admin roster: %w", err)
	}
	target, err := qtx.GetUserByID(ctx, targetID)
	if err != nil {
		return dbgen.User{}, notFoundOr(err, "user")
	}
	if authctx.Role(target.Role) == authctx.RoleAdmin && target.DeactivatedAt == nil {
		n, err := qtx.CountAdmins(ctx)
		if err != nil {
			return dbgen.User{}, fmt.Errorf("count admins: %w", err)
		}
		if n <= 1 {
			return dbgen.User{}, errLastAdmin
		}
	}
	u, err := write(qtx)
	if err != nil {
		return dbgen.User{}, notFoundOr(err, "user")
	}
	if err := tx.Commit(ctx); err != nil {
		return dbgen.User{}, fmt.Errorf("commit: %w", err)
	}
	return u, nil
}

// RenameAccount changes an account's username and/or display name on an
// admin's behalf — same rules as the profile page's own rename.
func (s *Service) RenameAccount(ctx context.Context, userID string, username, displayName *string) (AccountSummary, error) {
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return AccountSummary{}, notFoundOr(err, "user")
	}
	if username != nil {
		name := strings.ToLower(strings.TrimSpace(*username))
		if !usernameRE.MatchString(name) {
			return AccountSummary{}, connect.NewError(connect.CodeInvalidArgument,
				errors.New("username must be 3-32 letters, numbers, or _"))
		}
		if reservedUsernames[name] {
			return AccountSummary{}, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("%q is reserved; pick another username", name))
		}
		u, err = s.q.AdminSetUsername(ctx, dbgen.AdminSetUsernameParams{ID: userID, Username: name})
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return AccountSummary{}, connect.NewError(connect.CodeAlreadyExists,
					errors.New("username is taken"))
			}
			return AccountSummary{}, fmt.Errorf("update username: %w", err)
		}
	}
	if displayName != nil {
		name := strings.TrimSpace(*displayName)
		if name == "" || utf8.RuneCountInString(name) > maxDisplayNameLen {
			return AccountSummary{}, connect.NewError(connect.CodeInvalidArgument,
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
		return AccountSummary{}, notFoundOr(err, "user")
	}
	return toSummary(u), nil
}

// SetAccountUsernameFrozen locks or unlocks self-service renames on an
// account. Policy (no freezing admins) is enforced by the instance module.
func (s *Service) SetAccountUsernameFrozen(ctx context.Context, userID string, frozen bool) (AccountSummary, error) {
	if _, err := uuid.Parse(userID); err != nil {
		return AccountSummary{}, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
	}
	target, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return AccountSummary{}, notFoundOr(err, "user")
	}
	if err := refuseBotTarget(target, "a bot never renames itself, so there is nothing to freeze"); err != nil {
		return AccountSummary{}, err
	}
	u, err := s.q.SetUsernameFrozen(ctx, dbgen.SetUsernameFrozenParams{ID: userID, UsernameFrozen: frozen})
	if err != nil {
		return AccountSummary{}, notFoundOr(err, "user")
	}
	return toSummary(u), nil
}

func toSummary(u dbgen.User) AccountSummary {
	return AccountSummary{
		ID: u.ID, Username: u.Username, DisplayName: u.DisplayName,
		Role: authctx.Role(u.Role), Kind: authctx.IdentityKind(u.Kind), CreatedAt: u.CreatedAt, DeactivatedAt: u.DeactivatedAt,
		UsernameFrozen: u.UsernameFrozen,
		HasPassword:    u.PasswordHash != nil,
		Pronouns:       u.Pronouns,
		Bio:            u.Bio,
	}
}

// SetRoleByUsername is the CLI recovery path (stoop admin promote/demote):
// SetAccountRole by name, with its refusals as plain sentences.
func (s *Service) SetRoleByUsername(ctx context.Context, username string, role authctx.Role) (AccountSummary, error) {
	u, err := s.q.GetUserByUsername(ctx, username)
	if err != nil {
		return AccountSummary{}, notFoundOr(err, "user")
	}
	out, err := s.SetAccountRole(ctx, u.ID, role)
	var cerr *connect.Error
	if errors.As(err, &cerr) {
		return AccountSummary{}, errors.New(cerr.Message())
	}
	return out, err
}
