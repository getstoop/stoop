package auth

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"

	"github.com/alexedwards/argon2id"

	"github.com/Jhut89/stoop/internal/dbgen"
)

// Lost passwords. There is no email, so no self-service reset: an
// instance admin (or `stoop admin reset-password` for a locked-out admin)
// sets a temporary password that is shown once, and every session of the
// account is revoked. The person changes it on their profile page.

// tempPasswordAlphabet leaves out characters that are easy to misread
// when a password is read out or copied by hand (0/O, 1/l/I).
const tempPasswordAlphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

const tempPasswordLen = 16

func generateTempPassword() (string, error) {
	out := make([]byte, tempPasswordLen)
	n := big.NewInt(int64(len(tempPasswordAlphabet)))
	for i := range out {
		idx, err := rand.Int(rand.Reader, n)
		if err != nil {
			return "", fmt.Errorf("generate password: %w", err)
		}
		out[i] = tempPasswordAlphabet[idx.Int64()]
	}
	return string(out), nil
}

// ResetPassword sets a fresh temporary password on the account and signs
// it out everywhere. Exposed for the instance module's user-admin port.
func (s *Service) ResetPassword(ctx context.Context, userID string) (temporary string, summary AccountSummary, err error) {
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return "", AccountSummary{}, notFoundOr(err, "user")
	}
	temporary, err = generateTempPassword()
	if err != nil {
		return "", AccountSummary{}, err
	}
	hash, err := argon2id.CreateHash(temporary, s.argon2)
	if err != nil {
		return "", AccountSummary{}, fmt.Errorf("hash password: %w", err)
	}
	if err := s.q.UpdateUserPasswordHash(ctx, dbgen.UpdateUserPasswordHashParams{ID: u.ID, PasswordHash: &hash}); err != nil {
		return "", AccountSummary{}, fmt.Errorf("update password: %w", err)
	}
	if err := s.q.DeleteUserSessions(ctx, u.ID); err != nil {
		return "", AccountSummary{}, fmt.Errorf("revoke sessions: %w", err)
	}
	return temporary, toSummary(u), nil
}

// ResetPasswordByUsername is ResetPassword for the CLI.
func (s *Service) ResetPasswordByUsername(ctx context.Context, username string) (temporary string, summary AccountSummary, err error) {
	u, err := s.q.GetUserByUsername(ctx, username)
	if err != nil {
		return "", AccountSummary{}, notFoundOr(err, "user")
	}
	return s.ResetPassword(ctx, u.ID)
}
