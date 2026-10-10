package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/mail"
	"github.com/getstoop/stoop/internal/rowid"
)

const (
	// confirmEmailPurpose is email_tokens.purpose for a confirmation link.
	confirmEmailPurpose = "confirm_email"
	// confirmEmailLifetime is how long a confirmation link works.
	confirmEmailLifetime = 24 * time.Hour
)

// BuildConfirmEmail writes the confirmation link for the user's pending
// address, minting its token now so the token is never stored with the
// job. A mail.Builder for mail.TemplateConfirmEmail.
func (s *Service) BuildConfirmEmail(ctx context.Context, args mail.JobArgs, site mail.Site) (mail.Message, error) {
	recipient, err := s.emailRecipient(ctx, args.UserID)
	if err != nil {
		return mail.Message{}, err
	}
	if recipient.Deactivated || recipient.PendingEmail == nil || *recipient.PendingEmail == "" {
		return mail.Message{}, mail.ErrNothingToSend
	}
	if site.PublicURL == "" {
		return mail.Message{}, mail.ErrNoPublicURL
	}
	address := *recipient.PendingEmail
	token, tokenID, err := s.mintEmailToken(ctx, args.UserID, confirmEmailPurpose, address, time.Now().Add(confirmEmailLifetime))
	if err != nil {
		return mail.Message{}, err
	}
	link := strings.TrimRight(site.PublicURL, "/") + "/confirm-email?token=" + token
	msg, err := mail.Render(mail.TemplateConfirmEmail, mail.ConfirmEmailData{Username: recipient.Username, Link: link}, site)
	if err != nil {
		return mail.Message{}, err
	}
	msg.To = address
	// Older links die only once this one is on its way, so a send that
	// fails leaves the link the person already has working.
	msg.OnSent = func(ctx context.Context) error {
		return s.q.DeleteOlderEmailTokens(ctx, tokenID)
	}
	return msg, nil
}

// BuildEmailChanged tells the old address that the account's address
// changed. A mail.Builder for mail.TemplateEmailChanged.
func (s *Service) BuildEmailChanged(ctx context.Context, args mail.JobArgs, site mail.Site) (mail.Message, error) {
	if args.OldAddress == "" {
		return mail.Message{}, mail.ErrNothingToSend
	}
	recipient, err := s.emailRecipient(ctx, args.UserID)
	if err != nil {
		return mail.Message{}, err
	}
	// A job queued before At was recorded says when it is sent.
	at := args.At
	if at.IsZero() {
		at = time.Now()
	}
	msg, err := mail.Render(mail.TemplateEmailChanged, mail.EmailChangedData{Username: recipient.Username, At: at}, site)
	if err != nil {
		return mail.Message{}, err
	}
	msg.To = args.OldAddress
	return msg, nil
}

// emailRecipient reads the user a message is about; one that no longer
// exists has nothing to send.
func (s *Service) emailRecipient(ctx context.Context, userID string) (dbgen.GetEmailRecipientRow, error) {
	if _, err := uuid.Parse(userID); err != nil {
		return dbgen.GetEmailRecipientRow{}, mail.ErrNothingToSend
	}
	recipient, err := s.q.GetEmailRecipient(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return dbgen.GetEmailRecipientRow{}, mail.ErrNothingToSend
	}
	return recipient, err
}

// mintEmailToken stores the hash of a new link token for address; the
// raw token is returned for the link and kept nowhere else. Older links
// stay until the message is sent (see BuildConfirmEmail).
func (s *Service) mintEmailToken(ctx context.Context, userID, purpose, address string, expires time.Time) (token, tokenID string, err error) {
	token = randomToken()
	tokenID = rowid.New()
	err = s.q.CreateEmailToken(ctx, dbgen.CreateEmailTokenParams{
		ID: tokenID, UserID: userID, Purpose: purpose,
		TokenHash: hashToken(token), Address: address, ExpiresAt: expires,
	})
	if err != nil {
		return "", "", err
	}
	return token, tokenID, nil
}
