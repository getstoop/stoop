package auth

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"

	"connectrpc.com/connect"

	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/rowid"
)

// Lost passwords, reset by an admin: an instance admin (or `stoop admin
// reset-password` for a locked-out admin) sets a temporary password that
// is shown once, and every session of the account is revoked. The person
// changes it on their profile page. Reset by email is password_reset.go.

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
// it out everywhere. Exposed for the instance module's user-admin port,
// which never resets the owner: only the owner changes that password, or
// the host operator through the CLI.
func (s *Service) ResetPassword(ctx context.Context, userID string) (temporary string, summary AccountSummary, err error) {
	if err := rowid.Require(userID, "user"); err != nil {
		return "", AccountSummary{}, err
	}
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return "", AccountSummary{}, apierr.NotFoundOr(err, "user")
	}
	if u.IsOwner {
		return "", AccountSummary{}, connect.NewError(connect.CodePermissionDenied,
			errors.New("only the server owner can change their password; on the host, stoop admin reset-password can"))
	}
	return s.resetPassword(ctx, u)
}

func (s *Service) resetPassword(ctx context.Context, u dbgen.User) (temporary string, summary AccountSummary, err error) {
	if err := refuseBotTarget(u, "a bot has no password; it acts through its tokens and webhooks"); err != nil {
		return "", AccountSummary{}, err
	}
	temporary, err = generateTempPassword()
	if err != nil {
		return "", AccountSummary{}, err
	}
	hash, err := s.hashPassword(ctx, temporary)
	if err != nil {
		return "", AccountSummary{}, hashFailure("hash password", err)
	}
	if err := s.setPasswordHash(ctx, u.ID, hash); err != nil {
		return "", AccountSummary{}, err
	}
	if err := s.revokeAll(ctx, u.ID); err != nil {
		return "", AccountSummary{}, err
	}
	u.PasswordHash = &hash
	return temporary, toSummary(u), nil
}

// ResetPasswordByUsername is ResetPassword for the CLI, where the owner's
// password can be reset too: whoever runs it holds the host.
func (s *Service) ResetPasswordByUsername(ctx context.Context, username string) (temporary string, summary AccountSummary, err error) {
	account, err := s.userByUsername(ctx, username)
	if err != nil {
		return "", AccountSummary{}, err
	}
	return s.resetPassword(ctx, account)
}
