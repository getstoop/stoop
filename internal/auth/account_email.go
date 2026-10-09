package auth

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
)

// EmailJobs queues send_email jobs inside the caller's transaction, so a
// confirmation is only sent for a change that committed.
type EmailJobs interface {
	EnqueueTx(ctx context.Context, tx pgx.Tx, kind string, args any) (string, error)
}

// UseEmailPorts wires the job queue and the instance's "can send email"
// switch.
func (s *Service) UseEmailPorts(jobs EmailJobs, enabled func(ctx context.Context) (bool, error)) {
	s.emailJobs = jobs
	s.emailEnabled = enabled
}

var errEmailNotBuilt = errors.New("account email is not built yet")

func (s *Service) RequestEmailChange(ctx context.Context, req *connect.Request[authv1.RequestEmailChangeRequest]) (*connect.Response[authv1.RequestEmailChangeResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errEmailNotBuilt)
}

func (s *Service) ResendEmailConfirmation(ctx context.Context, req *connect.Request[authv1.ResendEmailConfirmationRequest]) (*connect.Response[authv1.ResendEmailConfirmationResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errEmailNotBuilt)
}

func (s *Service) CancelEmailChange(ctx context.Context, req *connect.Request[authv1.CancelEmailChangeRequest]) (*connect.Response[authv1.CancelEmailChangeResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errEmailNotBuilt)
}

func (s *Service) RemoveEmail(ctx context.Context, req *connect.Request[authv1.RemoveEmailRequest]) (*connect.Response[authv1.RemoveEmailResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errEmailNotBuilt)
}

func (s *Service) ConfirmEmail(ctx context.Context, req *connect.Request[authv1.ConfirmEmailRequest]) (*connect.Response[authv1.ConfirmEmailResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errEmailNotBuilt)
}
