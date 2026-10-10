package mail_test

import (
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/mail"
)

var update = flag.Bool("update", false, "rewrite the golden files in testdata")

var (
	goldenSite      = mail.Site{PublicURL: "https://chat.example.com/", InstanceName: "Brownstone"}
	goldenTime      = time.Date(2026, time.October, 9, 22, 14, 0, 0, time.UTC)
	goldenLink      = "https://chat.example.com/confirm-email?token=Xq3vR8kL2mN7pQ4sT9wY1zA6bC0dE5fG3hJ8kM2nP7q"
	goldenResetLink = "https://chat.example.com/reset-password?token=Pq7mR8kL2mN7pQ4sT9wY1zA6bC0dE5fG3hJ8kM2nXv"
)

// goldenMessages is every template with the data the golden files show.
var goldenMessages = map[string]any{
	mail.TemplateConfirmEmail:    mail.ConfirmEmailData{Username: "casey", Link: goldenLink},
	mail.TemplateEmailChanged:    mail.EmailChangedData{Username: "casey", At: goldenTime},
	mail.TemplatePasswordReset:   mail.PasswordResetData{Username: "casey", Link: goldenResetLink},
	mail.TemplatePasswordChanged: mail.PasswordChangedData{Username: "casey", At: goldenTime},
	mail.TemplateSMTPTest:        mail.SMTPTestData{Host: "smtp.example.net", SentAt: goldenTime},
}

func TestRenderGolden(t *testing.T) {
	for name, data := range goldenMessages {
		msg, err := mail.Render(name, data, goldenSite)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if msg.To != "" || msg.OnSent != nil {
			t.Errorf("%s: Render set To or OnSent", name)
		}
		compareGolden(t, name+".txt.golden", "Subject: "+msg.Subject+"\n\n"+msg.Text)
		compareGolden(t, name+".html.golden", msg.HTML)
	}
}

func compareGolden(t *testing.T, file, got string) {
	t.Helper()
	path := filepath.Join("testdata", file)
	if *update {
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (run go test ./internal/mail/... -update)", err)
	}
	if got != string(want) {
		t.Errorf("%s differs from what Render wrote:\n%s", path, got)
	}
}

// Names are escaped in the HTML and left as typed in the text.
func TestRenderEscapes(t *testing.T) {
	const hostile = `<script>alert(1)</script> & "x"`
	site := mail.Site{PublicURL: "https://chat.example.com", InstanceName: hostile}
	msg, err := mail.Render(mail.TemplateEmailChanged, mail.EmailChangedData{Username: hostile, At: goldenTime}, site)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(msg.HTML, "<script>") || strings.Contains(msg.HTML, `& "x"`) {
		t.Errorf("HTML holds the name unescaped:\n%s", msg.HTML)
	}
	if !strings.Contains(msg.HTML, "@&lt;script&gt;alert(1)&lt;/script&gt; &amp; &#34;x&#34;") {
		t.Errorf("HTML lacks the escaped name:\n%s", msg.HTML)
	}
	if !strings.Contains(msg.Text, "@"+hostile+" on "+hostile) {
		t.Errorf("text changed the name:\n%s", msg.Text)
	}
	if msg.Subject != "Your email address on "+hostile+" was changed" {
		t.Errorf("subject = %q", msg.Subject)
	}
}

// A public URL that isn't http(s) never becomes a working href. Saving
// one is refused elsewhere; this holds even if one got through.
func TestRenderNeutralisesScriptURL(t *testing.T) {
	site := mail.Site{PublicURL: "javascript://x/%0aalert(1)", InstanceName: "Brownstone"}
	msg, err := mail.Render(mail.TemplateConfirmEmail, mail.ConfirmEmailData{Username: "casey", Link: "javascript://x/%0aalert(1)"}, site)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(msg.HTML, `href="javascript:`) {
		t.Errorf("a javascript: URL reached an href:\n%s", msg.HTML)
	}
}

// A name with a line break can't add a header.
func TestRenderSubjectIsOneLine(t *testing.T) {
	site := mail.Site{PublicURL: "https://chat.example.com", InstanceName: "Brownstone\r\nBcc: ada@example.net"}
	msg, err := mail.Render(mail.TemplateSMTPTest, mail.SMTPTestData{Host: "smtp.example.net", SentAt: goldenTime}, site)
	if err != nil {
		t.Fatal(err)
	}
	if strings.ContainsAny(msg.Subject, "\r\n") {
		t.Errorf("subject = %q", msg.Subject)
	}
}

// Every template renders with its own struct and refuses anything else.
func TestRenderData(t *testing.T) {
	for name, data := range goldenMessages {
		if _, err := mail.Render(name, data, goldenSite); err != nil {
			t.Errorf("%s: %v", name, err)
		}
		for _, wrong := range []any{nil, map[string]any{}, struct{ Username string }{"casey"}} {
			if _, err := mail.Render(name, wrong, goldenSite); err == nil {
				t.Errorf("%s rendered with %#v", name, wrong)
			}
		}
	}
	if _, err := mail.Render(mail.TemplateSMTPTest, mail.ConfirmEmailData{Username: "casey", Link: goldenLink}, goldenSite); err == nil {
		t.Error("smtp_test rendered with another message's data")
	}
	if _, err := mail.Render("password_reset", mail.ConfirmEmailData{}, goldenSite); err == nil {
		t.Error("an unknown template rendered")
	}
}

// The confirmation's text part carries the whole link on its own line.
func TestRenderConfirmLinkLine(t *testing.T) {
	msg, err := mail.Render(mail.TemplateConfirmEmail, mail.ConfirmEmailData{Username: "ada", Link: goldenLink}, goldenSite)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg.Text, "\n\n"+goldenLink+"\n\n") {
		t.Errorf("the link is not on a line of its own:\n%s", msg.Text)
	}
}

// With no public address the footer and the sign-in line leave it out.
func TestRenderWithoutPublicURL(t *testing.T) {
	msg, err := mail.Render(mail.TemplateEmailChanged, mail.EmailChangedData{Username: "bea", At: goldenTime}, mail.Site{InstanceName: "Brownstone"})
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{msg.Text, msg.HTML} {
		if !strings.Contains(part, "Sent by Brownstone. ") || !strings.Contains(part, "sign in and change your password") || strings.Contains(part, "()") {
			t.Errorf("without a public URL:\n%s", part)
		}
	}
}
