package auth

import (
	"context"

	"github.com/getstoop/stoop/internal/mail"
)

// BuildConfirmEmail writes the confirmation link for the user's pending
// address, minting its token now so the token is never stored with the
// job. A mail.Builder for mail.TemplateConfirmEmail.
func (s *Service) BuildConfirmEmail(ctx context.Context, args mail.JobArgs, site mail.Site) (mail.Message, error) {
	return mail.Message{}, errEmailNotBuilt
}

// BuildEmailChanged tells the old address that the account's address
// changed. A mail.Builder for mail.TemplateEmailChanged.
func (s *Service) BuildEmailChanged(ctx context.Context, args mail.JobArgs, site mail.Site) (mail.Message, error) {
	return mail.Message{}, errEmailNotBuilt
}
