package app_test

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/mail/mailtest"
)

var resetLink = regexp.MustCompile(`https://chat\.example\.com/reset-password\?token=([A-Za-z0-9_-]+)`)

// The whole round: a confirmed address asks for a reset, the link from the
// email names the account and sets a new password, every old session is
// signed out, the link is spent, and the address is told. An address with
// no account gets the same reply, a job of its own, and no email.
func TestE2EPasswordResetRoundTrip(t *testing.T) {
	databaseURL := dbtest.NewURL(t)
	stoop := newHarnessOn(t, databaseURL, "STOOP_PUBLIC_URL", "https://chat.example.com")
	casey := stoop.person("casey")
	if strings.Contains(stoop.rpc("", email+"GetInstanceStatus", map[string]any{}).expect(t, "ok").raw, "passwordResetAvailable") {
		t.Error("password reset offered before email is set up")
	}
	stoop.rpc("", accountAuth+"RequestPasswordReset", map[string]any{"email": "casey@example.com"}).expect(t, "failed_precondition")
	fake := mailtest.Start(t, mailtest.Options{})
	stoop.rpc(casey, email+"UpdateEmailSettings", map[string]any{"smtp": map[string]any{
		"enabled": true, "host": fake.Host, "port": fake.Port, "security": "SMTP_SECURITY_NONE",
		"fromAddress": "stoop@example.net", "hourlyLimit": 100,
	}}).expect(t, "ok")
	if !strings.Contains(stoop.rpc("", email+"GetInstanceStatus", map[string]any{}).expect(t, "ok").raw, `"passwordResetAvailable":true`) {
		t.Error("password reset not offered with email and a public URL")
	}

	stoop.rpc(casey, accountAuth+"RequestEmailChange", map[string]any{"address": "casey@example.com", "password": password}).expect(t, "ok")
	_, confirmText := readEmail(t, fake.Next(t))
	stoop.rpc("", accountAuth+"ConfirmEmail", map[string]any{"token": confirmLink.FindStringSubmatch(confirmText)[1]}).expect(t, "ok")
	laptop := stoop.rpc("", accountAuth+"Login", map[string]any{"username": "casey", "password": password}).expect(t, "ok").str("token")

	unknown := stoop.rpc("", accountAuth+"RequestPasswordReset", map[string]any{"email": "nobody@example.com"}).expect(t, "ok")
	known := stoop.rpc("", accountAuth+"RequestPasswordReset", map[string]any{"email": "Casey@example.com"}).expect(t, "ok")
	if unknown.status != known.status || unknown.raw != known.raw {
		t.Errorf("replies differ: unknown %d %s, known %d %s", unknown.status, unknown.raw, known.status, known.raw)
	}

	received := fake.Next(t)
	subject, parts := readEmailParts(t, received)
	if len(received.To) != 1 || received.To[0] != "casey@example.com" || !strings.HasPrefix(subject, "Reset your password on") {
		t.Fatalf("first email after the requests = to %v, subject %q; want casey's reset link", received.To, subject)
	}
	match := resetLink.FindStringSubmatch(parts["text/plain"])
	if match == nil || !strings.Contains(parts["text/html"], `href="`+match[0]+`"`) {
		t.Fatalf("no reset link in %q", parts["text/plain"])
	}
	token := match[1]

	if got := stoop.rpc("", accountAuth+"GetPasswordReset", map[string]any{"token": token}).expect(t, "ok").str("username"); got != "casey" {
		t.Errorf("GetPasswordReset username = %q, want casey", got)
	}
	stoop.rpc("", accountAuth+"CompletePasswordReset", map[string]any{"token": token, "newPassword": "short"}).
		expect(t, "invalid_argument")
	stoop.rpc("", accountAuth+"CompletePasswordReset", map[string]any{"token": token, "newPassword": "a brand new password"}).expect(t, "ok")

	stoop.rpc(casey, accountAuth+"GetMe", map[string]any{}).expect(t, "unauthenticated")
	stoop.rpc(laptop, accountAuth+"GetMe", map[string]any{}).expect(t, "unauthenticated")
	stoop.rpc("", accountAuth+"Login", map[string]any{"username": "casey", "password": password}).expect(t, "unauthenticated")
	stoop.rpc("", accountAuth+"Login", map[string]any{"username": "casey", "password": "a brand new password"}).expect(t, "ok")
	stoop.rpc("", accountAuth+"CompletePasswordReset", map[string]any{"token": token, "newPassword": "another new password"}).
		expect(t, "failed_precondition", "This link has expired or was already used.")
	stoop.rpc("", accountAuth+"GetPasswordReset", map[string]any{"token": token}).
		expect(t, "failed_precondition", "This link has expired or was already used.")

	notice := fake.Next(t)
	subject, parts = readEmailParts(t, notice)
	if len(notice.To) != 1 || notice.To[0] != "casey@example.com" || !strings.HasPrefix(subject, "Your password on") {
		t.Fatalf("notice = to %v, subject %q", notice.To, subject)
	}
	for _, part := range []string{parts["text/plain"], parts["text/html"]} {
		if !strings.Contains(part, "every device was signed out") || !strings.Contains(part, "https://chat.example.com/forgot-password") || strings.Contains(part, token) {
			t.Errorf("notice part = %q", part)
		}
	}

	// Each request queued one job, the unknown address's included, and a
	// finished job keeps no address.
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	deadline := time.Now().Add(10 * time.Second)
	for {
		var total, cleared int
		if err := pool.QueryRow(context.Background(),
			`SELECT count(*), count(*) FILTER (WHERE state = 'succeeded' AND args = '{}'::jsonb) FROM jobs WHERE kind = 'send_email'`).
			Scan(&total, &cleared); err != nil {
			t.Fatal(err)
		}
		if total != 4 {
			t.Fatalf("%d send_email jobs, want 4", total)
		}
		if cleared == total {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d of %d send_email jobs finished with their args cleared", cleared, total)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// Asking for reset links draws on the per-IP sign-in bucket.
func TestE2EPasswordResetRequestsShareTheAuthLimit(t *testing.T) {
	stoop := newHarness(t, "STOOP_AUTH_RATE_LIMIT", "1")
	stoop.rpc("", accountAuth+"RequestPasswordReset", map[string]any{"email": "casey@example.com"}).expect(t, "failed_precondition")
	stoop.rpc("", accountAuth+"RequestPasswordReset", map[string]any{"email": "casey@example.com"}).expect(t, "resource_exhausted")
}
