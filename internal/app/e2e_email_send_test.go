package app_test

import (
	"strings"
	"testing"

	"github.com/getstoop/stoop/internal/mail/mailtest"
)

// A test email reaches the server the form names; a refused one says which
// field to fix.
func TestE2ESendTestEmail(t *testing.T) {
	stoop := newHarness(t)
	casey := stoop.person("casey")
	ada := stoop.person("ada")
	const send = "stoop.instance.v1.InstanceService/SendTestEmail"
	form := func(fake *mailtest.Server) map[string]any {
		return map[string]any{
			"smtp": map[string]any{
				"enabled": true, "host": fake.Host, "port": fake.Port,
				"security": "SMTP_SECURITY_NONE", "fromAddress": "stoop@example.net",
			},
			"to": "ada@example.com",
		}
	}

	fake := mailtest.Start(t, mailtest.Options{})
	sent := stoop.rpc(casey, send, form(fake)).expect(t, "ok")
	if got := sent.str("acceptedBy"); got != fake.Host {
		t.Errorf("acceptedBy = %q, want %q", got, fake.Host)
	}
	received := fake.Next(t)
	subject, parts := readEmailParts(t, received)
	if !strings.HasPrefix(subject, "Test email from ") || received.To[0] != "ada@example.com" {
		t.Errorf("test email = %+v", received)
	}
	for _, part := range []string{parts["text/plain"], parts["text/html"]} {
		if !strings.Contains(part, "can send email through "+fake.Host+".") {
			t.Errorf("the test email doesn't name the server it went through: %q", part)
		}
	}

	stoop.rpc(casey, send, map[string]any{"to": "ada@example.com"}).expect(t, "invalid_argument", "smtp settings are required")

	refused := mailtest.Start(t, mailtest.Options{RefuseRcpt: 550})
	refusal := stoop.rpc(casey, send, form(refused)).expect(t, "invalid_argument", "refused this recipient (550)")
	if got := refusal.field(); got != "to" {
		t.Errorf("refused recipient: field = %q, want to", got)
	}
	refused = mailtest.Start(t, mailtest.Options{RefuseMail: 553})
	refusal = stoop.rpc(casey, send, form(refused)).expect(t, "invalid_argument", "won't send from this address (553)")
	if got := refusal.field(); got != "smtp.from_address" {
		t.Errorf("refused sender: field = %q, want smtp.from_address", got)
	}

	// Five tries a minute per admin; this is casey's fifth, then the sixth.
	stoop.rpc(casey, send, form(fake)).expect(t, "ok")
	stoop.rpc(casey, send, form(fake)).expect(t, "resource_exhausted", "Too many test emails")

	stoop.rpc(ada, send, form(fake)).expect(t, "permission_denied")
}
