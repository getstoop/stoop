package auth

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/mail"
)

var errResetNotBuilt = errors.New("password reset is not built yet")

func (s *Service) RequestPasswordReset(ctx context.Context, req *connect.Request[authv1.RequestPasswordResetRequest]) (*connect.Response[authv1.RequestPasswordResetResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errResetNotBuilt)
}

func (s *Service) GetPasswordReset(ctx context.Context, req *connect.Request[authv1.GetPasswordResetRequest]) (*connect.Response[authv1.GetPasswordResetResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errResetNotBuilt)
}

func (s *Service) CompletePasswordReset(ctx context.Context, req *connect.Request[authv1.CompletePasswordResetRequest]) (*connect.Response[authv1.CompletePasswordResetResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errResetNotBuilt)
}

// BuildPasswordReset writes the reset link, minting its token now so the
// token is never stored with the job. A mail.Builder for
// mail.TemplatePasswordReset.
func (s *Service) BuildPasswordReset(ctx context.Context, args mail.JobArgs, site mail.Site) (mail.Message, error) {
	return mail.Message{}, errResetNotBuilt
}

// BuildPasswordChanged tells the account's address its password was
// reset. A mail.Builder for mail.TemplatePasswordChanged.
func (s *Service) BuildPasswordChanged(ctx context.Context, args mail.JobArgs, site mail.Site) (mail.Message, error) {
	return mail.Message{}, errResetNotBuilt
}
