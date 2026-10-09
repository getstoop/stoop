package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/jobs"
	"github.com/getstoop/stoop/internal/mail"
)

const (
	emailAttempts = 5
	// emailSendSlots is how many send_email jobs run at once.
	emailSendSlots = 2
)

var emailBackoff = []time.Duration{time.Minute, 5 * time.Minute, 30 * time.Minute}

// emailInstance is what a send_email job needs from the instance: where
// links point, the name messages carry, and the capped sender.
type emailInstance interface {
	mail.Sender
	PublicURL(ctx context.Context) (string, error)
	InstanceName(ctx context.Context) (string, error)
}

// registerEmail binds send_email to auth's message builders and the
// instance's sender. See docs/architecture/email.md.
func registerEmail(registry *jobs.Registry, authSvc *auth.Service, instance emailInstance) {
	builders := map[string]mail.Builder{
		mail.TemplateConfirmEmail: authSvc.BuildConfirmEmail,
		mail.TemplateEmailChanged: authSvc.BuildEmailChanged,
	}
	jobs.Register(registry, mail.SendEmailKind, func(ctx context.Context, _ *jobs.Job, args mail.JobArgs) error {
		return sendEmail(ctx, builders, instance, args)
	}, jobs.Options{MaxAttempts: emailAttempts, Backoff: emailBackoff, MaxInFlight: emailSendSlots})
}

// sendEmail builds the job's message now and sends it, mapping the
// result onto the dispatcher's outcomes.
func sendEmail(ctx context.Context, builders map[string]mail.Builder, instance emailInstance, args mail.JobArgs) error {
	build, ok := builders[args.Template]
	if !ok {
		return jobs.Discard(fmt.Errorf("unknown email template %q", args.Template))
	}
	publicURL, err := instance.PublicURL(ctx)
	if err != nil {
		return err
	}
	name, err := instance.InstanceName(ctx)
	if err != nil {
		return err
	}
	msg, err := build(ctx, args, mail.Site{PublicURL: publicURL, InstanceName: name})
	switch {
	case errors.Is(err, mail.ErrNothingToSend):
		return nil
	case errors.Is(err, mail.ErrNoPublicURL):
		return jobs.Discard(err)
	case err != nil:
		return err
	}
	if err := instance.Send(ctx, msg); err != nil {
		return emailSendOutcome(err, time.Now())
	}
	// The message is out: what follows it can't undo that, so a failure
	// here is logged, not retried (a retry would send it again).
	if msg.OnSent != nil {
		if err := msg.OnSent(ctx); err != nil {
			slog.Error("after sending email", "template", args.Template, "err", err)
		}
	}
	return nil
}

// emailSendOutcome maps a send's result: a cap waits for its window, a
// refusal that will not change (5xx, email off) is discarded, and the
// rest retries on the backoff.
func emailSendOutcome(err error, now time.Time) error {
	var limit *mail.HourlyLimitError
	var refusal *mail.Refusal
	switch {
	case err == nil:
		return nil
	case errors.Is(err, mail.ErrNotConfigured):
		return jobs.Discard(err)
	case errors.As(err, &limit):
		return jobs.RetryIn(err, max(limit.Until.Sub(now), 0))
	case errors.As(err, &refusal) && refusal.Code >= 500 && refusal.Code < 600:
		return jobs.Discard(err)
	}
	return err
}
