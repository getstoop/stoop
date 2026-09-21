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
	"github.com/getstoop/stoop/internal/apierr"
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
// argument leaves the column alone; empty clears it. field is the request
// field, which is also the word for it in the sentence.
func profileText(v *string, field string, max int) (*string, error) {
	if v == nil {
		return nil, nil
	}
	text := oneLine(*v)
	if utf8.RuneCountInString(text) > max {
		return nil, apierr.Field(connect.CodeInvalidArgument, field,
			fmt.Errorf("%s must be %d characters or fewer", field, max))
	}
	return &text, nil
}

func (s *Service) UpdateProfile(ctx context.Context, req *connect.Request[authv1.UpdateProfileRequest]) (*connect.Response[authv1.UpdateProfileResponse], error) {
	if err := refuseBotCaller(ctx, "a bot's profile is set by a server admin"); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.Msg.DisplayName)
	if name == "" || utf8.RuneCountInString(name) > maxDisplayNameLen {
		return nil, apierr.Field(connect.CodeInvalidArgument, "display_name",
			fmt.Errorf("display name must be 1-%d characters", maxDisplayNameLen))
	}
	// Usernames are freely changeable: everything durable binds to the
	// user id, and provider identities link by (provider, subject).
	if req.Msg.Username != nil {
		username := strings.ToLower(strings.TrimSpace(*req.Msg.Username))
		if !usernameRE.MatchString(username) {
			return nil, apierr.Field(connect.CodeInvalidArgument, "username",
				errors.New("username must be 3-32 letters, numbers, or _"))
		}
		if reservedUsernames[username] {
			return nil, apierr.Field(connect.CodeInvalidArgument, "username",
				fmt.Errorf("%q is reserved; pick another username", username))
		}
		if _, err := s.q.SetUsername(ctx, dbgen.SetUsernameParams{
			ID: authctx.UserID(ctx), Username: username,
		}); err != nil {
			var pgErr *pgconn.PgError
			switch {
			case errors.Is(err, pgx.ErrNoRows):
				// The only way the row doesn't match: an admin froze it.
				return nil, apierr.Field(connect.CodeFailedPrecondition, "username",
					errors.New("an admin has locked your username"))
			case errors.As(err, &pgErr) && pgErr.Code == "23505":
				return nil, apierr.Field(connect.CodeAlreadyExists, "username",
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
		return nil, apierr.Field(connect.CodeInvalidArgument, "new_password",
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
			return nil, apierr.Field(connect.CodeInvalidArgument, "current_password", errors.New("current password is incorrect"))
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
	sessions, err := s.q.DeleteOtherSessions(ctx, dbgen.DeleteOtherSessionsParams{
		HolderID: id.UserID, ID: id.SessionID,
	})
	if err != nil {
		return nil, fmt.Errorf("revoke other sessions: %w", err)
	}
	for _, r := range sessions {
		s.announceRevoked(r.ID, r.HolderID)
	}
	if req.Msg.RevokePersonalTokens {
		tokens, err := s.q.DeleteUserPersonalTokens(ctx, id.UserID)
		if err != nil {
			return nil, fmt.Errorf("revoke personal tokens: %w", err)
		}
		for _, r := range tokens {
			s.announceRevoked(r.ID, r.HolderID)
		}
	}
	return connect.NewResponse(&authv1.ChangePasswordResponse{}), nil
}

// refuseBotCaller keeps an action that belongs to a person's own account
// away from a bot token, with the reason in words.
func refuseBotCaller(ctx context.Context, reason string) error {
	if id, _ := authctx.From(ctx); id.Kind == authctx.KindBot {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New(reason))
	}
	return nil
}

// refuseBotTarget keeps an admin action that only makes sense for a
// person away from a bot account.
func refuseBotTarget(u dbgen.User, reason string) error {
	if u.Kind == string(authctx.KindBot) {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New(reason))
	}
	return nil
}
