package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/dbgen"
)

// AccountSummary is what the instance module's user administration sees.
type AccountSummary struct {
	ID            string
	Username      string
	DisplayName   string
	Role          authctx.Role
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
	out := make([]AccountSummary, len(rows))
	for i, r := range rows {
		out[i] = toSummary(r)
	}
	return out, nil
}

func (s *Service) SetAccountRole(ctx context.Context, userID string, role authctx.Role) (AccountSummary, error) {
	u, err := s.q.SetUserRole(ctx, dbgen.SetUserRoleParams{ID: userID, Role: string(role)})
	if err != nil {
		return AccountSummary{}, notFoundOr(err, "user")
	}
	return toSummary(u), nil
}

// SetAccountActive deactivates or reactivates an account. Deactivating
// revokes every session immediately; the row (and the user's messages)
// remain.
func (s *Service) SetAccountActive(ctx context.Context, userID string, active bool) (AccountSummary, error) {
	u, err := s.q.SetUserDeactivated(ctx, dbgen.SetUserDeactivatedParams{ID: userID, Deactivated: !active})
	if err != nil {
		return AccountSummary{}, notFoundOr(err, "user")
	}
	if !active {
		if err := s.q.DeleteUserSessions(ctx, userID); err != nil {
			return AccountSummary{}, fmt.Errorf("revoke sessions: %w", err)
		}
	}
	return toSummary(u), nil
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
	u, err := s.q.SetUsernameFrozen(ctx, dbgen.SetUsernameFrozenParams{ID: userID, UsernameFrozen: frozen})
	if err != nil {
		return AccountSummary{}, notFoundOr(err, "user")
	}
	return toSummary(u), nil
}

func toSummary(u dbgen.User) AccountSummary {
	return AccountSummary{
		ID: u.ID, Username: u.Username, DisplayName: u.DisplayName,
		Role: authctx.Role(u.Role), CreatedAt: u.CreatedAt, DeactivatedAt: u.DeactivatedAt,
		UsernameFrozen: u.UsernameFrozen,
		HasPassword:    u.PasswordHash != nil,
		Pronouns:       u.Pronouns,
		Bio:            u.Bio,
	}
}

// SetRoleByUsername is the CLI recovery path (stoop admin promote/demote).
// Demoting the last active admin is refused so the instance can't be left
// without an administrator.
func (s *Service) SetRoleByUsername(ctx context.Context, username string, role authctx.Role) (AccountSummary, error) {
	if role == authctx.RoleMember {
		u, err := s.q.GetUserByUsername(ctx, username)
		if err != nil {
			return AccountSummary{}, notFoundOr(err, "user")
		}
		if authctx.Role(u.Role) == authctx.RoleAdmin && u.DeactivatedAt == nil {
			n, err := s.q.CountAdmins(ctx)
			if err != nil {
				return AccountSummary{}, fmt.Errorf("count admins: %w", err)
			}
			if n <= 1 {
				return AccountSummary{}, errors.New("refusing to demote the last active admin; promote someone else first")
			}
		}
	}
	u, err := s.q.SetUserRoleByUsername(ctx, dbgen.SetUserRoleByUsernameParams{Username: username, Role: string(role)})
	if err != nil {
		return AccountSummary{}, notFoundOr(err, "user")
	}
	return toSummary(u), nil
}
