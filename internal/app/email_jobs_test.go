package app

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/jobs"
	"github.com/getstoop/stoop/internal/mail"
)

func TestEmailSendOutcome(t *testing.T) {
	now := time.Date(2026, 10, 9, 14, 20, 0, 0, time.UTC)
	limit := &mail.HourlyLimitError{Limit: 100, Until: now.Add(40 * time.Minute)}
	staleLimit := &mail.HourlyLimitError{Limit: 100, Until: now.Add(-time.Second)}
	permanent := &mail.Refusal{Field: "to", Code: 550, Message: "smtp.example.net refused this recipient (550)."}
	temporary := &mail.Refusal{Code: 451, Message: "smtp.example.net said try again later (451)."}
	unreachable := &mail.Refusal{Field: "host", Message: "Couldn't reach smtp.example.net."}
	other := errors.New("read settings: connection reset")
	for _, test := range []struct {
		name string
		err  error
		want error
	}{
		{"sent", nil, nil},
		{"email off", mail.ErrNotConfigured, jobs.Discard(mail.ErrNotConfigured)},
		{"hourly cap", limit, jobs.RetryIn(limit, 40*time.Minute)},
		{"hourly cap already over", staleLimit, jobs.RetryIn(staleLimit, 0)},
		{"5xx", permanent, jobs.Discard(permanent)},
		{"wrapped 5xx", fmt.Errorf("send: %w", permanent), jobs.Discard(fmt.Errorf("send: %w", permanent))},
		{"4xx", temporary, temporary},
		{"no reply", unreachable, unreachable},
		{"anything else", other, other},
	} {
		if got := emailSendOutcome(test.err, now); !reflect.DeepEqual(got, test.want) {
			t.Errorf("%s: got %#v, want %#v", test.name, got, test.want)
		}
	}
}

type fakeEmailInstance struct {
	publicURL string
	sent      []mail.Message
	sendErr   error
}

func (f *fakeEmailInstance) Send(_ context.Context, msg mail.Message) error {
	f.sent = append(f.sent, msg)
	return f.sendErr
}
func (f *fakeEmailInstance) PublicURL(context.Context) (string, error) { return f.publicURL, nil }
func (f *fakeEmailInstance) InstanceName(context.Context) (string, error) {
	return "Example Stoop", nil
}

func TestSendEmailBuildOutcome(t *testing.T) {
	failure := errors.New("database is down")
	builderReturning := func(err error) mail.Builder {
		return func(_ context.Context, _ mail.JobArgs, site mail.Site) (mail.Message, error) {
			if site.PublicURL != "https://chat.example.com" || site.InstanceName != "Example Stoop" {
				t.Errorf("site = %+v", site)
			}
			return mail.Message{To: "ada@example.com"}, err
		}
	}
	for _, test := range []struct {
		name     string
		template string
		buildErr error
		want     error
		sends    int
	}{
		{"unknown template", "welcome", nil, jobs.Discard(errors.New(`unknown email template "welcome"`)), 0},
		{"built", "confirm_email", nil, nil, 1},
		{"nothing to send", "confirm_email", mail.ErrNothingToSend, nil, 0},
		{"no public address", "confirm_email", mail.ErrNoPublicURL, jobs.Discard(mail.ErrNoPublicURL), 0},
		{"build failed", "confirm_email", failure, failure, 0},
	} {
		instance := &fakeEmailInstance{publicURL: "https://chat.example.com"}
		builders := map[string]mail.Builder{"confirm_email": builderReturning(test.buildErr)}
		got := sendEmail(context.Background(), builders, instance, mail.JobArgs{Template: test.template})
		if !reflect.DeepEqual(got, test.want) || len(instance.sent) != test.sends {
			t.Errorf("%s: got %#v after %d sends, want %#v after %d", test.name, got, len(instance.sent), test.want, test.sends)
		}
	}
}

// What a message does after its send (retiring older links) happens only
// when the server took it.
func TestSendEmailRunsOnSentOnlyAfterASend(t *testing.T) {
	for _, test := range []struct {
		name    string
		sendErr error
		wantRan bool
	}{
		{"accepted", nil, true},
		{"refused", &mail.Refusal{Code: 451, Message: "try again later"}, false},
		{"hourly cap", &mail.HourlyLimitError{Limit: 100, Until: time.Now().Add(time.Hour)}, false},
	} {
		ran := false
		builders := map[string]mail.Builder{mail.TemplateConfirmEmail: func(context.Context, mail.JobArgs, mail.Site) (mail.Message, error) {
			return mail.Message{To: "ada@example.com", OnSent: func(context.Context) error { ran = true; return nil }}, nil
		}}
		instance := &fakeEmailInstance{publicURL: "https://chat.example.com", sendErr: test.sendErr}
		_ = sendEmail(context.Background(), builders, instance, mail.JobArgs{Template: mail.TemplateConfirmEmail, UserID: "u"})
		if ran != test.wantRan {
			t.Errorf("%s: OnSent ran = %v, want %v", test.name, ran, test.wantRan)
		}
	}
}
