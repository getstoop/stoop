package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
)

// errEmailLinkSpent covers a bad, used, expired or superseded link alike.
var errEmailLinkSpent = connect.NewError(connect.CodeFailedPrecondition,
	errors.New("This link has expired or was already used."))

// errEmailInUse is the one place that says an address is taken: only the
// inbox's owner gets this far.
var errEmailInUse = connect.NewError(connect.CodeAlreadyExists,
	errors.New("This address is already in use by another account."))

func (s *Service) ConfirmEmail(ctx context.Context, req *connect.Request[authv1.ConfirmEmailRequest]) (*connect.Response[authv1.ConfirmEmailResponse], error) {
	token := strings.TrimSpace(req.Msg.Token)
	if token == "" {
		return nil, errEmailLinkSpent
	}
	err := db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		qtx := s.q.WithTx(tx)
		owner, err := qtx.EmailTokenOwner(ctx, dbgen.EmailTokenOwnerParams{TokenHash: hashToken(token), Purpose: confirmEmailPurpose})
		if errors.Is(err, pgx.ErrNoRows) {
			return errEmailLinkSpent
		}
		if err != nil {
			return fmt.Errorf("look up link: %w", err)
		}
		// The account before the link, as every other address change does.
		if _, err := qtx.LockUserEmail(ctx, owner); err != nil {
			return fmt.Errorf("lock account: %w", err)
		}
		link, err := qtx.GetConfirmableEmailToken(ctx, dbgen.GetConfirmableEmailTokenParams{
			TokenHash: hashToken(token), Purpose: confirmEmailPurpose,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return errEmailLinkSpent
		}
		if err != nil {
			return fmt.Errorf("look up link: %w", err)
		}
		taken, err := qtx.EmailConfirmedElsewhere(ctx, dbgen.EmailConfirmedElsewhereParams{Address: link.Address, UserID: link.UserID})
		if err != nil {
			return fmt.Errorf("check address: %w", err)
		}
		if taken {
			return errEmailInUse
		}
		if err := qtx.ConfirmPendingEmail(ctx, link.UserID); err != nil {
			if db.HasCode(err, db.UniqueViolation) {
				return errEmailInUse
			}
			return fmt.Errorf("confirm email: %w", err)
		}
		if err := qtx.MarkEmailTokenUsed(ctx, link.ID); err != nil {
			return fmt.Errorf("use link: %w", err)
		}
		if err := qtx.DeleteOtherEmailTokens(ctx, dbgen.DeleteOtherEmailTokensParams{
			UserID: link.UserID, Purpose: confirmEmailPurpose, KeepID: link.ID,
		}); err != nil {
			return fmt.Errorf("revoke other links: %w", err)
		}
		// Reset links went to the address this one replaces.
		if err := qtx.DeleteUserEmailTokens(ctx, dbgen.DeleteUserEmailTokensParams{UserID: link.UserID, Purpose: resetPasswordPurpose}); err != nil {
			return fmt.Errorf("revoke reset links: %w", err)
		}
		if link.PreviousEmail == nil || strings.EqualFold(*link.PreviousEmail, link.Address) {
			return nil
		}
		return s.queueEmailChanged(ctx, tx, link.UserID, link.PreviousEmail)
	})
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&authv1.ConfirmEmailResponse{}), nil
}
