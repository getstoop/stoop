package instance

import (
	"errors"
	"strings"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/getstoop/stoop/gen/stoop/common/v1"
	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/mail"
)

// violatedField is the field a refusal names, "" when it names none.
func violatedField(t *testing.T, err error) string {
	t.Helper()
	var cerr *connect.Error
	if !errors.As(err, &cerr) {
		t.Fatalf("not a Connect error: %v", err)
	}
	for _, detail := range cerr.Details() {
		msg, derr := detail.Value()
		if derr != nil {
			t.Fatal(derr)
		}
		if violation, ok := msg.(*commonv1.FieldViolation); ok {
			return violation.Field
		}
	}
	return ""
}

func validSMTP() SMTP {
	return SMTP{
		Enabled: true, Host: "smtp.example.net", Port: 587, Security: mail.SecuritySTARTTLS,
		Username: "casey@example.net", Password: "hunter22", FromAddress: "stoop@example.net",
		FromName: "The Stoop", HourlyLimit: DefaultHourlyLimit,
	}
}

func TestSMTPValidate(t *testing.T) {
	for _, rule := range []struct {
		name  string
		edit  func(*SMTP)
		field string
	}{
		{"a complete server", func(*SMTP) {}, ""},
		{"an IPv4 host", func(smtp *SMTP) { smtp.Host = "192.168.1.20" }, ""},
		{"an IPv6 host", func(smtp *SMTP) { smtp.Host = "fd00::25" }, ""},
		{"a relay without sign-in", func(smtp *SMTP) {
			smtp.Security, smtp.Port, smtp.Username, smtp.Password = mail.SecurityNone, 25, "", ""
		}, ""},
		{"off with nothing filled in", func(smtp *SMTP) { *smtp = SMTP{Port: 587, Security: mail.SecuritySTARTTLS} }, ""},
		{"no cap", func(smtp *SMTP) { smtp.HourlyLimit = 0 }, ""},
		{"the highest cap", func(smtp *SMTP) { smtp.HourlyLimit = 100000 }, ""},
		{"no host while on", func(smtp *SMTP) { smtp.Host = "" }, "smtp.host"},
		{"a host with a scheme", func(smtp *SMTP) { smtp.Host = "smtp://smtp.example.net" }, "smtp.host"},
		{"a host with a port", func(smtp *SMTP) { smtp.Host = "smtp.example.net:587" }, "smtp.host"},
		{"a malformed host while off", func(smtp *SMTP) { smtp.Enabled, smtp.Host = false, "smtp example net" }, "smtp.host"},
		{"port 0", func(smtp *SMTP) { smtp.Port = 0 }, "smtp.port"},
		{"port 65536", func(smtp *SMTP) { smtp.Port = 65536 }, "smtp.port"},
		{"an unknown security mode", func(smtp *SMTP) { smtp.Security = "ssl" }, "smtp.security"},
		{"a username in the clear", func(smtp *SMTP) { smtp.Security = mail.SecurityNone }, "smtp.security"},
		{"a username without a password", func(smtp *SMTP) { smtp.Password = "" }, "smtp.password"},
		{"a password without a username", func(smtp *SMTP) { smtp.Username = "" }, "smtp.password"},
		{"no from address while on", func(smtp *SMTP) { smtp.FromAddress = "" }, "smtp.from_address"},
		{"a from address with a name", func(smtp *SMTP) { smtp.FromAddress = "Stoop <stoop@example.net>" }, "smtp.from_address"},
		{"two from addresses", func(smtp *SMTP) { smtp.FromAddress = "a@example.net, b@example.net" }, "smtp.from_address"},
		{"not an address", func(smtp *SMTP) { smtp.FromAddress = "stoop" }, "smtp.from_address"},
		{"a long sender name", func(smtp *SMTP) { smtp.FromName = strings.Repeat("x", 81) }, "smtp.from_name"},
		{"a sender name over two lines", func(smtp *SMTP) { smtp.FromName = "The\r\nStoop" }, "smtp.from_name"},
		{"a negative cap", func(smtp *SMTP) { smtp.HourlyLimit = -1 }, "smtp.hourly_limit"},
		{"too high a cap", func(smtp *SMTP) { smtp.HourlyLimit = 100001 }, "smtp.hourly_limit"},
	} {
		smtp := validSMTP()
		rule.edit(&smtp)
		err := smtp.validate()
		if rule.field == "" {
			if err != nil {
				t.Errorf("%s: refused: %v", rule.name, err)
			}
			continue
		}
		if err == nil {
			t.Errorf("%s: saved, want a refusal on %s", rule.name, rule.field)
			continue
		}
		if got := violatedField(t, err); got != rule.field {
			t.Errorf("%s: field = %q, want %q (%v)", rule.name, got, rule.field, err)
		}
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("%s: code = %v, want invalid_argument", rule.name, connect.CodeOf(err))
		}
	}
}

func TestSMTPFromProto(t *testing.T) {
	current := validSMTP()

	got := smtpFromProto(&instancev1.SmtpSettings{Host: " smtp.example.net ", Username: "casey@example.net"}, current)
	if got.Password != current.Password {
		t.Errorf("a blank password lost the saved one: %q", got.Password)
	}
	if got.Host != "smtp.example.net" {
		t.Errorf("host not trimmed: %q", got.Host)
	}
	if got.Security != mail.SecuritySTARTTLS || got.Port != 587 {
		t.Errorf("unspecified security and port 0: %s:%d, want starttls:587", got.Security, got.Port)
	}

	if got = smtpFromProto(&instancev1.SmtpSettings{Username: "casey@example.net", Password: "new-one"}, current); got.Password != "new-one" {
		t.Errorf("a typed password didn't replace the saved one: %q", got.Password)
	}
	if got = smtpFromProto(&instancev1.SmtpSettings{}, current); got.Username != "" || got.Password != "" {
		t.Errorf("clearing the username kept the password: %+v", got)
	}

	for security, port := range map[instancev1.SmtpSecurity]int{
		instancev1.SmtpSecurity_SMTP_SECURITY_STARTTLS: 587,
		instancev1.SmtpSecurity_SMTP_SECURITY_TLS:      465,
		instancev1.SmtpSecurity_SMTP_SECURITY_NONE:     25,
	} {
		if got = smtpFromProto(&instancev1.SmtpSettings{Security: security}, current); got.Port != port {
			t.Errorf("%v with no port: %d, want %d", security, got.Port, port)
		}
	}
	if got = smtpFromProto(&instancev1.SmtpSettings{Security: instancev1.SmtpSecurity_SMTP_SECURITY_TLS, Port: 2465}, current); got.Port != 2465 {
		t.Errorf("a given port was replaced: %d", got.Port)
	}

	got = smtpFromProto(&instancev1.SmtpSettings{Security: 42}, current)
	if err := got.validate(); violatedField(t, err) != "smtp.security" {
		t.Errorf("an unknown security mode: %v, want a refusal on smtp.security", err)
	}
}

func TestSMTPToProtoNeverShowsThePassword(t *testing.T) {
	shown := validSMTP().toProto()
	if shown.Password != "" || !shown.HasPassword {
		t.Errorf("password = %q, has_password = %v", shown.Password, shown.HasPassword)
	}
	if shown.Security != instancev1.SmtpSecurity_SMTP_SECURITY_STARTTLS || shown.Port != 587 || shown.HourlyLimit != 100 {
		t.Errorf("shown = %+v", shown)
	}
	if (SMTP{}).toProto().HasPassword {
		t.Error("no password shows as set")
	}
}
