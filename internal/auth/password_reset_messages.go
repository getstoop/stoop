package auth

import (
	"context"
	"strings"
	"time"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/mail"
)

// BuildPasswordReset writes the reset link, minting its token now so the
// token is never stored with the job. A mail.Builder for
// mail.TemplatePasswordReset.
func (s *Service) BuildPasswordReset(ctx context.Context, args mail.JobArgs, site mail.Site) (mail.Message, error) {
	recipient, err := s.emailRecipient(ctx, args.UserID)
	if err != nil {
		return mail.Message{}, err
	}
	if recipient.Deactivated || recipient.Kind != string(authctx.KindPerson) || recipient.Email == nil || *recipient.Email == "" {
		return mail.Message{}, mail.ErrNothingToSend
	}
	if site.PublicURL == "" {
		return mail.Message{}, mail.ErrNoPublicURL
	}
	address := *recipient.Email
	token, tokenID, err := s.mintEmailToken(ctx, args.UserID, resetPasswordPurpose, address, time.Now().Add(resetPasswordLifetime))
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
		return s.q.DeleteOlderEmailTokens(ctx, tokenID)
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
