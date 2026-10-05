package auth

import (
	"context"
	"errors"
	"fmt"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/alexedwards/argon2id"
	"github.com/jackc/pgx/v5"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/text"
)

const (
	maxDisplayNameLen = 50
	maxPronounsLen    = 40
	maxBioLen         = 300
	minPasswordLen    = 8
)

// profileText normalises one optional free-text profile field. A nil
// argument leaves the column alone; empty clears it. field is the request
// field, which is also the word for it in the sentence.
func profileText(v *string, field string, max int) (*string, error) {
	if v == nil {
		return nil, nil
	}
	value := text.OneLine(*v)
	if utf8.RuneCountInString(value) > max {
		return nil, apierr.Field(connect.CodeInvalidArgument, field,
			fmt.Errorf("%s must be %d characters or fewer", field, max))
	}
	return &value, nil
}

func (s *Service) UpdateProfile(ctx context.Context, req *connect.Request[authv1.UpdateProfileRequest]) (*connect.Response[authv1.UpdateProfileResponse], error) {
	if err := refuseBotCaller(ctx, "a bot's profile is set by a server admin"); err != nil {
		return nil, err
	}
	// Every field is checked before anything is written, so a refusal of
	// one leaves the profile as it was.
	name, err := displayNameFrom(req.Msg.DisplayName)
	if err != nil {
		return nil, err
	}
	// Usernames are freely changeable: everything durable binds to the
	// user id, and provider identities link by (provider, subject).
	var username *string
	if req.Msg.Username != nil {
		checked, err := usernameFrom(*req.Msg.Username)
		if err != nil {
			return nil, err
		}
		username = &checked
	}
	pronouns, err := profileText(req.Msg.Pronouns, "pronouns", maxPronounsLen)
	if err != nil {
		return nil, err
	}
	bio, err := profileText(req.Msg.Bio, "bio", maxBioLen)
	if err != nil {
		return nil, err
	}
	userID := authctx.UserID(ctx)
	var user dbgen.User
	err = s.inTx(ctx, func(qtx *dbgen.Queries) error {
		if username != nil {
			if _, err := qtx.SetUsername(ctx, dbgen.SetUsernameParams{ID: userID, Username: *username}); err != nil {
				switch {
				case errors.Is(err, pgx.ErrNoRows):
					// The only way the row doesn't match: an admin froze it.
					return apierr.Field(connect.CodeFailedPrecondition, "username",
						errors.New("an admin has locked your username"))
				case db.HasCode(err, db.UniqueViolation):
					return apierr.Field(connect.CodeAlreadyExists, "username",
						errors.New("username is taken"))
				default:
					return fmt.Errorf("set username: %w", err)
				}
			}
		}
		user, err = qtx.UpdateUserProfile(ctx, dbgen.UpdateUserProfileParams{
			ID: userID, DisplayName: &name, Pronouns: pronouns, Bio: bio,
		})
		if err != nil {
			return fmt.Errorf("update profile: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
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
