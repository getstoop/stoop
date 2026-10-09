package instance_test

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/instance"
	"github.com/getstoop/stoop/internal/mail"
)

var envSMTP = instance.SMTP{
	Host: "smtp.example.net", Security: mail.SecurityTLS, Username: "casey@example.net",
	Password: "env-password", FromAddress: "stoop@example.net", HourlyLimit: 50,
}

// The environment seeds the row once, switched on; a later start with a
// changed .env leaves it alone.
func TestSMTPSeedFromEnv(t *testing.T) {
	pool := dbtest.New(t)
	users := newFakeUsers(instance.UserSummary{ID: "a1", Username: "ada", Role: authctx.RoleAdmin})
	ctx := context.Background()
	start := func(smtp instance.SMTP) *instance.Service {
		svc := instance.New(pool, users)
		svc.UseSMTPEnv(smtp)
		if err := svc.SeedFromEnv(ctx); err != nil {
			t.Fatal(err)
		}
		return svc
	}

	svc := start(instance.SMTP{})
	if smtp, err := svc.SMTPSettings(ctx); err != nil || smtp.Enabled || smtp.Host != "" || smtp.HourlyLimit != instance.DefaultHourlyLimit {
		t.Fatalf("no env: %+v, %v", smtp, err)
	}

	svc = start(envSMTP)
	smtp, err := svc.SMTPSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	want := envSMTP
	want.Enabled, want.Port = true, 465
	if smtp != want {
		t.Errorf("seeded %+v, want %+v", smtp, want)
	}

	changed := envSMTP
	changed.Host, changed.Password = "mail.example.com", "rotated"
	svc = start(changed)
	if smtp, _ = svc.SMTPSettings(ctx); smtp.Host != "smtp.example.net" || smtp.Password != "env-password" {
		t.Errorf("a changed env replaced the seeded row: %+v", smtp)
	}
	svc.UseEnvSet(func(name string) bool { return name == "STOOP_SMTP_HOST" || name == "STOOP_SMTP_PASSWORD" })
	drifted, err := svc.EnvDrift(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(drifted, []string{"STOOP_SMTP_HOST", "STOOP_SMTP_PASSWORD"}) {
		t.Errorf("drifted = %v", drifted)
	}
}

// A row saved from the admin page is never replaced by the environment.
func TestSMTPSeedLeavesASavedRow(t *testing.T) {
	pool := dbtest.New(t)
	users := newFakeUsers(instance.UserSummary{ID: "a1", Username: "ada", Role: authctx.RoleAdmin})
	ctx := context.Background()
	svc := instance.New(pool, users)
	if err := svc.SaveEmail(ctx, &instancev1.SmtpSettings{Host: "relay.example.com", Security: instancev1.SmtpSecurity_SMTP_SECURITY_NONE}); err != nil {
		t.Fatal(err)
	}
	svc = instance.New(pool, users)
	svc.UseSMTPEnv(envSMTP)
	if err := svc.SeedFromEnv(ctx); err != nil {
		t.Fatal(err)
	}
	if smtp, _ := svc.SMTPSettings(ctx); smtp.Host != "relay.example.com" || smtp.Enabled {
		t.Errorf("the env replaced a saved row: %+v", smtp)
	}
}

func TestEmailSettingsSave(t *testing.T) {
	svc := instance.New(dbtest.New(t), newFakeUsers(instance.UserSummary{ID: "a1", Username: "ada", Role: authctx.RoleAdmin}))
	admin := as("a1", authctx.RoleAdmin)
	ctx := context.Background()
	update := func(smtp *instancev1.SmtpSettings) (*instancev1.SmtpSettings, error) {
		resp, err := svc.UpdateEmailSettings(admin, connect.NewRequest(&instancev1.UpdateEmailSettingsRequest{Smtp: smtp}))
		if err != nil {
			return nil, err
		}
		return resp.Msg.Smtp, nil
	}
	server := &instancev1.SmtpSettings{
		Enabled: true, Host: "smtp.example.net", Username: "casey@example.net", Password: "hunter22",
		FromAddress: "stoop@example.net", HourlyLimit: 100,
	}
	shown, err := update(server)
	if err != nil {
		t.Fatal(err)
	}
	if shown.Password != "" || !shown.HasPassword || shown.Port != 587 || shown.Security != instancev1.SmtpSecurity_SMTP_SECURITY_STARTTLS {
		t.Errorf("shown = %+v", shown)
	}
	status, err := svc.GetInstanceStatus(ctx, connect.NewRequest(&instancev1.GetInstanceStatusRequest{}))
	if err != nil || !status.Msg.EmailEnabled {
		t.Errorf("email_enabled = false after saving a server on: %v", err)
	}

	// A refused save changes nothing.
	refused := &instancev1.SmtpSettings{Enabled: true, Host: "mail.example.com", FromAddress: "not an address"}
	if _, err := update(refused); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a bad from address: %v", err)
	}
	if smtp, _ := svc.SMTPSettings(ctx); smtp.Host != "smtp.example.net" || smtp.Password != "hunter22" {
		t.Errorf("a refused save wrote: %+v", smtp)
	}

	// Turning email off keeps every field.
	server.Enabled, server.Password = false, ""
	if _, err := update(server); err != nil {
		t.Fatal(err)
	}
	smtp, _ := svc.SMTPSettings(ctx)
	if smtp.Enabled || smtp.Host != "smtp.example.net" || smtp.Password != "hunter22" || smtp.FromAddress != "stoop@example.net" {
		t.Errorf("switching off lost a field: %+v", smtp)
	}
	if status, _ = svc.GetInstanceStatus(ctx, connect.NewRequest(&instancev1.GetInstanceStatusRequest{})); status.Msg.EmailEnabled {
		t.Error("email_enabled = true with the server off")
	}

	got, err := svc.GetEmailSettings(admin, connect.NewRequest(&instancev1.GetEmailSettingsRequest{}))
	if err != nil || got.Msg.Smtp.Password != "" || !got.Msg.Smtp.HasPassword {
		t.Errorf("get: %+v, %v", got, err)
	}
	member := as("a1", authctx.RoleMember)
	if _, err := svc.UpdateEmailSettings(member, connect.NewRequest(&instancev1.UpdateEmailSettingsRequest{Smtp: server})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member saved email settings: %v", err)
	}
}

// stoop admin sets fields one at a time, keeping the rest and the password.
func TestSMTPSettingFields(t *testing.T) {
	svc := instance.New(dbtest.New(t), newFakeUsers(instance.UserSummary{ID: "a1", Username: "ada", Role: authctx.RoleAdmin}))
	ctx := context.Background()
	if err := svc.SetSettingFields(ctx, map[string]string{
		"smtp.enabled": "true", "smtp.host": "smtp.example.net", "smtp.security": "tls",
		"smtp.username": "casey@example.net", "smtp.password": "hunter22", "smtp.from-address": "stoop@example.net",
	}); err != nil {
		t.Fatal(err)
	}
	if err := svc.SetSettingFields(ctx, map[string]string{"smtp.hourly-limit": "20"}); err != nil {
		t.Fatal(err)
	}
	smtp, _ := svc.SMTPSettings(ctx)
	if smtp.Port != 465 || smtp.Password != "hunter22" || smtp.HourlyLimit != 20 || !smtp.Enabled {
		t.Errorf("after two sets: %+v", smtp)
	}
	if err := svc.SetSettingFields(ctx, map[string]string{"smtp.security": "none"}); err == nil {
		t.Error("none with a username was saved")
	}
	if err := svc.ClearSetting(ctx, "smtp"); err != nil {
		t.Fatal(err)
	}
	if smtp, _ = svc.SMTPSettings(ctx); smtp.Enabled || smtp.Host != "" || smtp.Password != "" {
		t.Errorf("after clear: %+v", smtp)
	}
}
