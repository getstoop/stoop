package app_test

import (
	"strings"
	"testing"

	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/mail/mailtest"
)

// The whole round: ask for an address, the job sends its link, the link
// confirms it; a second address then replaces it and the first is told.
func TestE2EAccountEmailRoundTrip(t *testing.T) {
	stoop := newHarnessOn(t, dbtest.NewURL(t), "STOOP_PUBLIC_URL", "https://chat.example.com")
	casey := stoop.person("casey")
	fake := mailtest.Start(t, mailtest.Options{})
	stoop.rpc(casey, email+"UpdateEmailSettings", map[string]any{"smtp": map[string]any{
		"enabled": true, "host": fake.Host, "port": fake.Port, "security": "SMTP_SECURITY_NONE",
		"fromAddress": "stoop@example.net", "hourlyLimit": 100,
	}}).expect(t, "ok")

	linkFor := func(address string) string {
		t.Helper()
		received := fake.Next(t)
		if len(received.To) != 1 || received.To[0] != address {
			t.Fatalf("sent to %v, want %s", received.To, address)
		}
		_, text := readEmail(t, received)
		match := confirmLink.FindStringSubmatch(text)
		if match == nil {
			t.Fatalf("no confirmation link in %q", text)
		}
		return match[1]
	}

	stoop.rpc(casey, accountAuth+"RequestEmailChange", map[string]any{"address": "casey@example.com", "password": password}).expect(t, "ok")
	first := linkFor("casey@example.com")
	stoop.rpc("", accountAuth+"ConfirmEmail", map[string]any{"token": first}).expect(t, "ok")
	if got := stoop.rpc(casey, accountAuth+"GetMe", map[string]any{}).expect(t, "ok").str("email.address"); got != "casey@example.com" {
		t.Fatalf("GetMe email = %q, want casey@example.com", got)
	}
	stoop.rpc("", accountAuth+"ConfirmEmail", map[string]any{"token": first}).expect(t, "failed_precondition", "expired or was already used")

	stoop.rpc(casey, accountAuth+"RequestEmailChange", map[string]any{"address": "casey@example.net", "password": password}).expect(t, "ok")
	second := linkFor("casey@example.net")
	stoop.rpc("", accountAuth+"ConfirmEmail", map[string]any{"token": second}).expect(t, "ok")
	if got := stoop.rpc(casey, accountAuth+"GetMe", map[string]any{}).expect(t, "ok").str("email.address"); got != "casey@example.net" {
		t.Fatalf("GetMe email after the change = %q, want casey@example.net", got)
	}

	notice := fake.Next(t)
	subject, text := readEmail(t, notice)
	if len(notice.To) != 1 || notice.To[0] != "casey@example.com" || !strings.Contains(subject, "was changed") {
		t.Fatalf("notice = to %v, subject %q", notice.To, subject)
	}
	if strings.Contains(text, "casey@example.net") || strings.Contains(text, "confirm-email") {
		t.Errorf("the notice shows the new address or a link: %q", text)
	}
}
