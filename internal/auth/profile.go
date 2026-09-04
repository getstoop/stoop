package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/alexedwards/argon2id"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

const (
	maxDisplayNameLen = 50
	maxPronounsLen    = 40
	maxBioLen         = 300
	minPasswordLen    = 8
)

// oneLine collapses runs of whitespace, so a pasted line break becomes a
// space rather than a tall profile card. chat has its own copy: modules
// don't import each other, and a package for one function is worse.
func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// profileText normalises one optional free-text profile field. A nil
// argument leaves the column alone; empty clears it.
func profileText(v *string, label string, max int) (*string, error) {
	if v == nil {
		return nil, nil
	}
	text := oneLine(*v)
	if utf8.RuneCountInString(text) > max {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("%s must be %d characters or fewer", label, max))
	}
	return &text, nil
}

func (s *Service) UpdateProfile(ctx context.Context, req *connect.Request[authv1.UpdateProfileRequest]) (*connect.Response[authv1.UpdateProfileResponse], error) {
	name := strings.TrimSpace(req.Msg.DisplayName)
	if name == "" || utf8.RuneCountInString(name) > maxDisplayNameLen {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("display name must be 1-%d characters", maxDisplayNameLen))
	}
	// Usernames are freely changeable: everything durable binds to the
	// user id, and provider identities link by (provider, subject).
	if req.Msg.Username != nil {
		username := strings.ToLower(strings.TrimSpace(*req.Msg.Username))
		if !usernameRE.MatchString(username) {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				errors.New("username must be 3-32 letters, numbers, or _"))
		}
		if reservedUsernames[username] {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("%q is reserved; pick another username", username))
		}
		if _, err := s.q.SetUsername(ctx, dbgen.SetUsernameParams{
			ID: authctx.UserID(ctx), Username: username,
		}); err != nil {
			var pgErr *pgconn.PgError
			switch {
			case errors.Is(err, pgx.ErrNoRows):
				// The only way the row doesn't match: an admin froze it.
				return nil, connect.NewError(connect.CodeFailedPrecondition,
					errors.New("an admin has locked your username"))
			case errors.As(err, &pgErr) && pgErr.Code == "23505":
				return nil, connect.NewError(connect.CodeAlreadyExists,
					errors.New("username is taken"))
			default:
				return nil, fmt.Errorf("set username: %w", err)
			}
		}
	}
	pronouns, err := profileText(req.Msg.Pronouns, "pronouns", maxPronounsLen)
	if err != nil {
		return nil, err
	}
	bio, err := profileText(req.Msg.Bio, "bio", maxBioLen)
	if err != nil {
		return nil, err
	}
	user, err := s.q.UpdateUserProfile(ctx, dbgen.UpdateUserProfileParams{
		ID: authctx.UserID(ctx), DisplayName: &name, Pronouns: pronouns, Bio: bio,
	})
	if err != nil {
		return nil, fmt.Errorf("update profile: %w", err)
	}
	return connect.NewResponse(&authv1.UpdateProfileResponse{User: toProtoUser(user)}), nil
}

func (s *Service) ChangePassword(ctx context.Context, req *connect.Request[authv1.ChangePasswordRequest]) (*connect.Response[authv1.ChangePasswordResponse], error) {
	id, ok := authctx.From(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("not logged in"))
	}
	if len(req.Msg.NewPassword) < minPasswordLen {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("new password must be at least %d characters", minPasswordLen))
	}

	user, err := s.q.GetUserByID(ctx, id.UserID)
	if err != nil {
		return nil, fmt.Errorf("look up user: %w", err)
	}
	// An account created via a login provider has no password yet; its
	// first one is set here with nothing to check against.
	if user.PasswordHash != nil {
		match, err := argon2id.ComparePasswordAndHash(req.Msg.CurrentPassword, *user.PasswordHash)
		if err != nil {
			return nil, fmt.Errorf("verify password: %w", err)
		}
		if !match {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("current password is incorrect"))
		}
	}

	hash, err := argon2id.CreateHash(req.Msg.NewPassword, s.argon2)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}
	if err := s.q.UpdateUserPasswordHash(ctx, dbgen.UpdateUserPasswordHashParams{
		ID: id.UserID, PasswordHash: &hash,
	}); err != nil {
		return nil, fmt.Errorf("update password: %w", err)
	}
	// Anyone holding an old session (a stolen cookie, a forgotten laptop)
	// is signed out; the caller's own session stays valid.
	if err := s.q.DeleteOtherSessions(ctx, dbgen.DeleteOtherSessionsParams{
		UserID: id.UserID, ID: id.SessionID,
	}); err != nil {
		return nil, fmt.Errorf("revoke other sessions: %w", err)
	}
	return connect.NewResponse(&authv1.ChangePasswordResponse{}), nil
}
