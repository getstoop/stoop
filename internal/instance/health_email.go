package instance

import (
	"context"
	"strconv"
	"time"
)

// EmailCheck is the Health row for outgoing email. It reads the last
// send's outcome and never dials the server: a sign-in on every refresh
// could trip a provider's limits.
func (s *Service) EmailCheck() HealthCheck {
	return HealthCheck{Name: "email", FixTab: "email", Run: func(ctx context.Context) (CheckState, string) {
		smtp, err := s.SMTPSettings(ctx)
		if err != nil {
			return CheckDanger, "could not read settings: " + err.Error()
		}
		last, err := s.LastSend(ctx)
		if err != nil {
			return CheckDanger, "could not read the last send: " + err.Error()
		}
		return emailState(smtp, last, time.Now())
	}}
}

func emailState(smtp SMTP, last SendOutcome, now time.Time) (CheckState, string) {
	if !smtp.Enabled || smtp.Host == "" {
		return CheckOff, "not set up"
	}
	switch {
	case last.At.IsZero():
		return CheckOK, smtp.Host + " · nothing sent yet"
	case last.OK:
		return CheckOK, smtp.Host + " · last send " + ago(now.Sub(last.At)) + " ago"
	default:
		return CheckWarn, "last send failed " + ago(now.Sub(last.At)) + " ago: " + last.Error
	}
}

// ago is a duration as the row reads it: 40 s, 12 min, 3 h, 2 d.
func ago(elapsed time.Duration) string {
	switch {
	case elapsed < time.Minute:
		return strconv.Itoa(int(elapsed/time.Second)) + " s"
	case elapsed < time.Hour:
		return strconv.Itoa(int(elapsed/time.Minute)) + " min"
	case elapsed < 48*time.Hour:
		return strconv.Itoa(int(elapsed/time.Hour)) + " h"
	default:
		return strconv.Itoa(int(elapsed/(24*time.Hour))) + " d"
	}
}
