package instance

import (
	"strings"
	"testing"
	"time"
)

func TestEmailState(t *testing.T) {
	now := time.Date(2026, 10, 9, 14, 0, 0, 0, time.UTC)
	on := SMTP{Enabled: true, Host: "smtp.example.net"}
	cases := []struct {
		name   string
		smtp   SMTP
		last   SendOutcome
		state  CheckState
		detail string
	}{
		{"no host", SMTP{Enabled: true}, SendOutcome{}, CheckOff, "not set up"},
		{"turned off", SMTP{Host: "smtp.example.net"}, SendOutcome{At: now, OK: false, Error: "x"}, CheckOff, "not set up"},
		{"nothing sent", on, SendOutcome{}, CheckOK, "nothing sent yet"},
		{"last ok", on, SendOutcome{At: now.Add(-12 * time.Minute), OK: true}, CheckOK, "last send 12 min ago"},
		{"last failed", on, SendOutcome{At: now.Add(-3 * time.Hour), Error: "smtp.example.net refused this username and password (535)."}, CheckWarn, "failed 3 h ago: smtp.example.net refused"},
	}
	for _, tc := range cases {
		state, detail := emailState(tc.smtp, tc.last, now)
		if state != tc.state || !strings.Contains(detail, tc.detail) {
			t.Errorf("%s: got %d %q, want %d containing %q", tc.name, state, detail, tc.state, tc.detail)
		}
	}
}
