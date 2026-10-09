package app_test

import (
	"strings"
	"testing"
)

const email = "stoop.instance.v1.InstanceService/"

// The Email form saves whole, reads back without its password, and a
// refused save names its field and changes nothing.
func TestE2EEmailSettings(t *testing.T) {
	harness := newHarness(t)
	casey := harness.person("casey")
	server := map[string]any{
		"enabled": true, "host": "smtp.example.net", "security": "SMTP_SECURITY_STARTTLS",
		"username": "casey@example.net", "password": "hunter22-secret",
		"fromAddress": "stoop@example.net", "hourlyLimit": 100,
	}
	harness.rpc(casey, email+"UpdateEmailSettings", map[string]any{"smtp": server}).expect(t, "ok")

	answer := harness.rpc(casey, email+"GetEmailSettings", map[string]any{}).expect(t, "ok")
	if strings.Contains(answer.raw, "hunter22-secret") || !strings.Contains(answer.raw, `"hasPassword":true`) {
		t.Errorf("read back: %s", answer.raw)
	}
	if answer.str("smtp.host") != "smtp.example.net" || !strings.Contains(answer.raw, `"port":587`) {
		t.Errorf("read back: %s", answer.raw)
	}
	status := harness.rpc("", email+"GetInstanceStatus", map[string]any{}).expect(t, "ok")
	if !strings.Contains(status.raw, `"emailEnabled":true`) {
		t.Errorf("status: %s", status.raw)
	}

	refused := map[string]any{
		"enabled": true, "host": "mail.example.com", "security": "SMTP_SECURITY_NONE",
		"username": "casey@example.net", "fromAddress": "stoop@example.net",
	}
	answer = harness.rpc(casey, email+"UpdateEmailSettings", map[string]any{"smtp": refused}).expect(t, "invalid_argument")
	if got := answer.field(); got != "smtp.security" {
		t.Errorf("field = %q, want smtp.security (%s)", got, answer.message())
	}
	answer = harness.rpc(casey, email+"GetEmailSettings", map[string]any{}).expect(t, "ok")
	if answer.str("smtp.host") != "smtp.example.net" || answer.str("smtp.security") != "SMTP_SECURITY_STARTTLS" {
		t.Errorf("a refused save changed the settings: %s", answer.raw)
	}
}
