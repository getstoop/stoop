package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/mail"
)

// Password reset by email (docs/architecture/identity.md → Recovery).

const (
	// resetPasswordPurpose is email_tokens.purpose for a reset link.
	resetPasswordPurpose = "reset_password"
	// resetPasswordLifetime is how long a reset link works.
	resetPasswordLifetime = time.Hour
)

// UsePasswordResetThrottle wires the per-account limit on reset emails.
func (s *Service) UsePasswordResetThrottle(throttle Throttle) { s.resetThrottle = throttle }

func (s *Service) RequestPasswordReset(ctx context.Context, req *connect.Request[authv1.RequestPasswordResetRequest]) (*connect.Response[authv1.RequestPasswordResetResponse], error) {
	if err := s.requireEmailOn(ctx); err != nil {
		return nil, err
	}
	address := strings.TrimSpace(req.Msg.Email)
	if address == "" {
		return nil, apierr.Field(connect.CodeInvalidArgument, "email", errors.New("Enter an email address."))
	}
	userID, err := s.passwordResetAccount(ctx, address)
	if err != nil {
		return nil, err
	}
	// Every refusal from here on answers as a sent link does, so the
	// reply never says whether the address has an account.
	if userID != "" && s.allowPasswordResetEmail(ctx, userID) {
		if err := db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
			_, err := s.emailJobs.EnqueueTx(ctx, tx, mail.SendEmailKind, mail.JobArgs{
				Template: mail.TemplatePasswordReset, UserID: userID,
			})
			return err
		}); err != nil {
			return nil, fmt.Errorf("queue reset link: %w", err)
		}
	}
	return connect.NewResponse(&authv1.RequestPasswordResetResponse{}), nil
}

// passwordResetAccount is the account a reset link for address goes to,
// or "" when none may have one: no account holds it as its confirmed
// address, the account is a bot or deactivated, or password sign-in is
// not open to it.
func (s *Service) passwordResetAccount(ctx context.Context, address string) (string, error) {
	account, err := s.q.PasswordResetAccount(ctx, address)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("look up address: %w", err)
	}
	if account.Deactivated || account.Kind != string(authctx.KindPerson) {
		return "", nil
	}
	allowed, err := s.passwordResetAllowed(ctx, authctx.Role(account.Role))
	if err != nil || !allowed {
		return "", err
	}
	return account.ID, nil
}

// passwordResetAllowed follows password_sign_in without the admins'
// break-glass: with passwords off, nobody resets one by email.
func (s *Service) passwordResetAllowed(ctx context.Context, role authctx.Role) (bool, error) {
	if s.passwords == nil {
		return true, nil
	}
	policy, err := s.passwords.PasswordSignIn(ctx)
	if err != nil {
		return false, fmt.Errorf("read password sign-in: %w", err)
	}
	switch policy {
	case PasswordEveryone, "":
		return true, nil
	case PasswordAdmins:
		return role == authctx.RoleAdmin, nil
	}
	return false, nil
}

// allowPasswordResetEmail takes one of the account's reset emails for
// the hour. Over the limit, or with the limiter down, nothing is sent and
// the caller still hears success.
func (s *Service) allowPasswordResetEmail(ctx context.Context, userID string) bool {
	if s.resetThrottle == nil {
		return true
	}
	allowed, err := s.resetThrottle.Allow(ctx, userID)
	if err != nil {
		slog.Error("password reset throttle store", "err", err)
		return false
	}
	return allowed
}

func (s *Service) GetPasswordReset(ctx context.Context, req *connect.Request[authv1.GetPasswordResetRequest]) (*connect.Response[authv1.GetPasswordResetResponse], error) {
	link, err := s.livePasswordResetLink(ctx, req.Msg.Token)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&authv1.GetPasswordResetResponse{Username: link.Username}), nil
}

// livePasswordResetLink reads a reset link without using it up; a bad,
// used, expired or superseded one is errEmailLinkSpent.
func (s *Service) livePasswordResetLink(ctx context.Context, token string) (dbgen.GetPasswordResetTokenRow, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return dbgen.GetPasswordResetTokenRow{}, errEmailLinkSpent
	}
	link, err := s.q.GetPasswordResetToken(ctx, hashToken(token))
	if errors.Is(err, pgx.ErrNoRows) {
		return dbgen.GetPasswordResetTokenRow{}, errEmailLinkSpent
	}
	if err != nil {
		return dbgen.GetPasswordResetTokenRow{}, fmt.Errorf("look up link: %w", err)
	}
	return link, nil
}

func (s *Service) CompletePasswordReset(ctx context.Context, req *connect.Request[authv1.CompletePasswordResetRequest]) (*connect.Response[authv1.CompletePasswordResetResponse], error) {
	// The link is checked before the hash, so a bad one costs no argon2.
	if _, err := s.livePasswordResetLink(ctx, req.Msg.Token); err != nil {
		return nil, err
	}
	if len(req.Msg.NewPassword) < minPasswordLen {
		return nil, apierr.Field(connect.CodeInvalidArgument, "new_password",
			fmt.Errorf("Your new password must be at least %d characters.", minPasswordLen))
	}
	hash, err := s.hashPassword(ctx, req.Msg.NewPassword)
	if err != nil {
		return nil, hashFailure("hash password", err)
	}
	tokenHash := hashToken(strings.TrimSpace(req.Msg.Token))
	var username string
	var revoked []dbgen.DeleteUserSessionsRow
	err = db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		qtx := s.q.WithTx(tx)
		owner, err := qtx.EmailTokenOwner(ctx, dbgen.EmailTokenOwnerParams{TokenHash: tokenHash, Purpose: resetPasswordPurpose})
		if errors.Is(err, pgx.ErrNoRows) {
			return errEmailLinkSpent
		}
		if err != nil {
			return fmt.Errorf("look up link: %w", err)
		}
		// The account before the link, as every address change does.
		if _, err := qtx.LockUserEmail(ctx, owner); err != nil {
			return fmt.Errorf("lock account: %w", err)
		}
		link, err := qtx.LockPasswordResetToken(ctx, tokenHash)
		if errors.Is(err, pgx.ErrNoRows) {
			return errEmailLinkSpent
		}
		if err != nil {
			return fmt.Errorf("look up link: %w", err)
		}
		username = link.Username
		if err := qtx.UpdateUserPasswordHash(ctx, dbgen.UpdateUserPasswordHashParams{ID: link.UserID, PasswordHash: &hash}); err != nil {
			return fmt.Errorf("update password: %w", err)
		}
		if err := qtx.MarkEmailTokenUsed(ctx, link.ID); err != nil {
			return fmt.Errorf("use link: %w", err)
		}
		if err := qtx.DeleteOtherEmailTokens(ctx, dbgen.DeleteOtherEmailTokensParams{
			UserID: link.UserID, Purpose: resetPasswordPurpose, KeepID: link.ID,
		}); err != nil {
			return fmt.Errorf("revoke other links: %w", err)
		}
		if revoked, err = qtx.DeleteUserSessions(ctx, link.UserID); err != nil {
			return fmt.Errorf("revoke sessions: %w", err)
		}
		if req.Msg.RevokePersonalTokens {
			tokens, err := qtx.DeleteUserPersonalTokens(ctx, link.UserID)
			if err != nil {
				return fmt.Errorf("revoke personal tokens: %w", err)
			}
			for _, token := range tokens {
				revoked = append(revoked, dbgen.DeleteUserSessionsRow(token))
			}
		}
		if _, err := s.emailJobs.EnqueueTx(ctx, tx, mail.SendEmailKind, mail.JobArgs{
			Template: mail.TemplatePasswordChanged, UserID: link.UserID, At: time.Now().UTC(),
		}); err != nil {
			return fmt.Errorf("queue change notice: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, credential := range revoked {
		s.announceRevoked(credential.ID, credential.HolderID)
	}
	// The new password works at once, even on a handle that was locked.
	if err := s.guard.success(ctx, strings.ToLower(username)); err != nil {
		slog.Error("clear lockout after password reset", "err", err)
	}
	return connect.NewResponse(&authv1.CompletePasswordResetResponse{}), nil
}
