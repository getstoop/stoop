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
	token, tokenID, err := s.mintConfirmEmailToken(ctx, args.UserID, address, time.Now())
	if err != nil {
		return mail.Message{}, err
	}
	link := strings.TrimRight(site.PublicURL, "/") + "/confirm-email?token=" + token
	return mail.Message{
		To:      address,
		Subject: "Confirm your email for " + site.InstanceName,
		Text: "Someone asked to use this address for @" + recipient.Username + " on " + site.InstanceName + ".\n\n" +
			"To confirm it, open this link within 24 hours:\n\n" + link + "\n\n" +
			"If that wasn't you, ignore this email and nothing will change.\n",
		// Older links die only once this one is on its way, so a send that
		// fails leaves the link the person already has working.
		OnSent: func(ctx context.Context) error {
			return s.q.DeleteOlderEmailTokens(ctx, tokenID)
		},
	}, nil
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
	return mail.Message{
		To:      args.OldAddress,
		Subject: "Your email on " + site.InstanceName + " was changed",
		Text: "The email address for @" + recipient.Username + " on " + site.InstanceName + " was changed or removed.\n\n" +
			"If you did this, there's nothing to do. If you didn't, sign in and change your password, or ask an admin for help.\n",
	}, nil
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

// mintConfirmEmailToken stores the hash of a new confirmation token for
// address; the raw token is returned for the link and kept nowhere else.
// Older links stay until the message is sent (see BuildConfirmEmail).
func (s *Service) mintConfirmEmailToken(ctx context.Context, userID, address string, now time.Time) (token, tokenID string, err error) {
	token = randomToken()
	tokenID = rowid.New()
	err = s.q.CreateEmailToken(ctx, dbgen.CreateEmailTokenParams{
		ID: tokenID, UserID: userID, Purpose: confirmEmailPurpose,
		TokenHash: hashToken(token), Address: address, ExpiresAt: now.Add(confirmEmailLifetime),
	})
	if err != nil {
		return "", "", err
	}
	return token, tokenID, nil
}
