package instance

import (
	"context"
	"errors"
	"fmt"
	netmail "net/mail"
	"strings"
	"time"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/mail"
)

var _ mail.Sender = (*Service)(nil)

// Throttle is instance's port onto a rate limiter, keyed per account.
type Throttle interface {
	Allow(ctx context.Context, key string) (bool, error)
}

// UseTestEmailThrottle wires the per-account limit on SendTestEmail.
func (s *Service) UseTestEmailThrottle(throttle Throttle) { s.testEmailThrottle = throttle }

// Send delivers msg with the saved settings, within the hourly cap, and
// records the outcome for the Email health row.
func (s *Service) Send(ctx context.Context, msg mail.Message) error {
	smtp, err := s.SMTPSettings(ctx)
	if err != nil {
		return err
	}
	if !smtp.Enabled || smtp.Host == "" {
		return mail.ErrNotConfigured
	}
	server, err := s.mailServer(ctx, smtp)
	if err != nil {
		return err
	}
	if err := s.takeSendSlot(ctx, smtp.HourlyLimit, time.Now()); err != nil {
		return err
	}
	return s.deliver(ctx, server, msg)
}

func (s *Service) SendTestEmail(ctx context.Context, req *connect.Request[instancev1.SendTestEmailRequest]) (*connect.Response[instancev1.SendTestEmailResponse], error) {
	if err := apierr.RequireAction(ctx, authctx.InstanceSettingsManage); err != nil {
		return nil, err
	}
	if err := s.allowTestEmail(ctx); err != nil {
		return nil, err
	}
	if req.Msg.GetSmtp() == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("smtp settings are required"))
	}
	saved, err := s.SMTPSettings(ctx)
	if err != nil {
		return nil, err
	}
	smtp := smtpFromProto(req.Msg.GetSmtp(), saved)
	if err := smtp.validate(); err != nil {
		return nil, err
	}
	if smtp.Host == "" {
		return nil, apierr.Field(connect.CodeInvalidArgument, "smtp.host", errors.New("Enter the server's host name."))
	}
	if smtp.FromAddress == "" {
		return nil, apierr.Field(connect.CodeInvalidArgument, "smtp.from_address", errors.New("Enter the address email is sent from."))
	}
	to, err := netmail.ParseAddress(strings.TrimSpace(req.Msg.GetTo()))
	if err != nil {
		return nil, apierr.Field(connect.CodeInvalidArgument, "to", errors.New("Enter one email address to send the test to."))
	}
	server, err := s.mailServer(ctx, smtp)
	if err != nil {
		return nil, err
	}
	// The saved cap: trying a form doesn't raise it.
	if err := s.takeSendSlot(ctx, saved.HourlyLimit, time.Now()); err != nil {
		return nil, sendError(err)
	}
	name, err := s.InstanceName(ctx)
	if err != nil {
		return nil, err
	}
	err = s.deliver(ctx, server, mail.Message{
		To:      to.Address,
		Subject: "Test email from " + name,
		Text:    "This is a test email from " + name + ".\nIf you can read it, email from Stoop works.\n",
	})
	if err != nil {
		return nil, sendError(err)
	}
	return connect.NewResponse(&instancev1.SendTestEmailResponse{AcceptedBy: server.Host}), nil
}

func (s *Service) allowTestEmail(ctx context.Context) error {
	if s.testEmailThrottle == nil {
		return nil
	}
	allowed, err := s.testEmailThrottle.Allow(ctx, authctx.UserID(ctx))
	if err != nil {
		return connect.NewError(connect.CodeUnavailable, errors.New("Test email is unavailable right now. Try again in a moment."))
	}
	if !allowed {
		err := connect.NewError(connect.CodeResourceExhausted, errors.New("Too many test emails. Try again in a minute."))
		err.Meta().Set("Retry-After", "60")
		return err
	}
	return nil
}

// mailServer is the server to send through; a blank From name sends the
// instance name.
func (s *Service) mailServer(ctx context.Context, smtp SMTP) (mail.Server, error) {
	fromName := smtp.FromName
	if fromName == "" {
		name, err := s.InstanceName(ctx)
		if err != nil {
			return mail.Server{}, err
		}
		fromName = name
	}
	return mail.Server{
		Host: smtp.Host, Port: smtp.Port, Security: smtp.Security,
		Username: smtp.Username, Password: smtp.Password,
		FromAddress: smtp.FromAddress, FromName: fromName,
	}, nil
}

func (s *Service) deliver(ctx context.Context, server mail.Server, msg mail.Message) error {
	err := mail.Deliver(ctx, server, msg)
	// A send the caller gave up on says nothing about the server.
	if !errors.Is(ctx.Err(), context.Canceled) {
		s.recordSend(ctx, err)
	}
	return err
}

// sendError puts a failed send on the form field it is about.
func sendError(err error) error {
	var limit *mail.HourlyLimitError
	var refusal *mail.Refusal
	switch {
	case errors.As(err, &limit):
		return apierr.Field(connect.CodeFailedPrecondition, "to", fmt.Errorf(
			"This hour's %d emails are used; try again after %s.", limit.Limit, limit.Until.Local().Format("15:04")))
	case errors.As(err, &refusal) && refusal.Field == "":
		return connect.NewError(connect.CodeFailedPrecondition, errors.New(refusal.Message))
	case errors.As(err, &refusal) && refusal.Field == "to":
		return apierr.Field(connect.CodeInvalidArgument, "to", errors.New(refusal.Message))
	case errors.As(err, &refusal):
		return apierr.Field(connect.CodeInvalidArgument, "smtp."+refusal.Field, errors.New(refusal.Message))
	}
	return err
}
