package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/mail"
)

// BuildPasswordReset finds the account the reset was asked for and writes
// its link, minting the token now so it is never stored with the job.
// A mail.Builder for mail.TemplatePasswordReset.
func (s *Service) BuildPasswordReset(ctx context.Context, args mail.JobArgs, site mail.Site) (mail.Message, error) {
	userID := args.UserID
	if args.Email != "" {
		account, err := s.q.PasswordResetAccount(ctx, args.Email)
		if errors.Is(err, pgx.ErrNoRows) {
			return mail.Message{}, mail.ErrNothingToSend
		}
		if err != nil {
			return mail.Message{}, fmt.Errorf("look up address: %w", err)
		}
		userID = account
	}
	recipient, err := s.emailRecipient(ctx, userID)
	if err != nil {
		return mail.Message{}, err
	}
	if recipient.Email == nil || *recipient.Email == "" ||
		(args.Email != "" && !strings.EqualFold(*recipient.Email, args.Email)) {
		return mail.Message{}, mail.ErrNothingToSend
	}
	eligible, err := s.passwordResetEligible(ctx, recipient.Deactivated, recipient.Kind, recipient.Role)
	if err != nil {
		return mail.Message{}, err
	}
	if !eligible {
		return mail.Message{}, mail.ErrNothingToSend
	}
	if site.PublicURL == "" {
		return mail.Message{}, mail.ErrNoPublicURL
	}
	// A job queued by user id took its limit when it was asked for.
	if args.Email != "" && site.Attempt <= 1 && !s.allowPasswordResetEmail(ctx, userID) {
		return mail.Message{}, mail.ErrNothingToSend
	}
	address := *recipient.Email
	token, tokenID, err := s.mintEmailToken(ctx, userID, resetPasswordPurpose, address, time.Now().Add(resetPasswordLifetime))
	if err != nil {
		return mail.Message{}, err
	}
	link := strings.TrimRight(site.PublicURL, "/") + "/reset-password?token=" + token
	msg, err := mail.Render(mail.TemplatePasswordReset, mail.PasswordResetData{Username: recipient.Username, Link: link}, site)
	if err != nil {
		return mail.Message{}, err
	}
	msg.To = address
	// As with confirmation, older links die only once this one is sent.
	msg.OnSent = func(ctx context.Context) error {
		return s.retireOlderEmailTokens(ctx, userID, tokenID)
	}
	return msg, nil
}

// BuildPasswordChanged tells the account's address its password was
// reset. A mail.Builder for mail.TemplatePasswordChanged.
func (s *Service) BuildPasswordChanged(ctx context.Context, args mail.JobArgs, site mail.Site) (mail.Message, error) {
	recipient, err := s.emailRecipient(ctx, args.UserID)
	if err != nil {
		return mail.Message{}, err
	}
	if recipient.Email == nil || *recipient.Email == "" {
		return mail.Message{}, mail.ErrNothingToSend
	}
	at := args.At
	if at.IsZero() {
		at = time.Now()
	}
	msg, err := mail.Render(mail.TemplatePasswordChanged, mail.PasswordChangedData{Username: recipient.Username, At: at}, site)
	if err != nil {
		return mail.Message{}, err
	}
	msg.To = *recipient.Email
	return msg, nil
}
