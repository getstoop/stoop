package instance_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	instancev1 "github.com/Jhut89/stoop/gen/stoop/instance/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/db/dbtest"
	"github.com/Jhut89/stoop/internal/instance"
)

func TestLoginProviders(t *testing.T) {
	pool := dbtest.New(t)
	users := newFakeUsers(instance.UserSummary{ID: "a1", Username: "ada", Role: authctx.RoleAdmin})
	svc := instance.New(pool, users)
	svc.UseLoginProvidersEnv([]instance.LoginProvider{{
		ID: "sso", Kind: instance.KindOIDC, DisplayName: "Single sign-on", Icon: "key",
		Issuer: "https://env.idp.example.com", ClientID: "env-client", ClientSecret: "env-secret",
	}})
	svc.UseReachabilityEnv(instance.ReachabilityEnv{
		Reachability: instance.Reachability{PublicURL: "https://chat.example.com"},
	})
	admin, member := as("a1", authctx.RoleAdmin), as("m1", authctx.RoleMember)
	ctx := context.Background()

	// Members can't see or change providers.
	if _, err := svc.GetLoginProviders(member, connect.NewRequest(&instancev1.GetLoginProvidersRequest{})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member GetLoginProviders: %v", err)
	}

	// Nothing saved: the environment shows through, marked from_env, the
	// secret elided, and the callback URL built from the public URL.
	got, err := svc.GetLoginProviders(admin, connect.NewRequest(&instancev1.GetLoginProvidersRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Msg.Providers) != 1 {
		t.Fatalf("providers = %v", got.Msg.Providers)
	}
	p := got.Msg.Providers[0]
	if p.Id != "sso" || !p.FromEnv || !p.HasClientSecret || p.ClientSecret != "" ||
		p.CallbackUrl != "https://chat.example.com/auth/callback/sso" {
		t.Errorf("env provider = %+v", p)
	}

	// The port view carries the secret (in-process only).
	if lp, err := svc.LoginProvider(ctx, "sso"); err != nil || lp.ClientSecret != "env-secret" {
		t.Errorf("LoginProvider port = %+v, %v", lp, err)
	}

	up := func(rows ...*instancev1.LoginProvider) (*connect.Response[instancev1.UpdateLoginProvidersResponse], error) {
		return svc.UpdateLoginProviders(admin, connect.NewRequest(&instancev1.UpdateLoginProvidersRequest{Providers: rows}))
	}

	// Bad rows are rejected.
	for name, row := range map[string]*instancev1.LoginProvider{
		"bad id":     {Id: "X!", Issuer: "https://a.example.com", ClientId: "c", ClientSecret: "s"},
		"bad issuer": {Id: "okta", Issuer: "ftp://a", ClientId: "c", ClientSecret: "s"},
		"no client":  {Id: "okta", Issuer: "https://a.example.com", ClientSecret: "s"},
		"no secret":  {Id: "okta", Issuer: "https://a.example.com", ClientId: "c"},
		"bad icon":   {Id: "okta", Issuer: "https://a.example.com", ClientId: "c", ClientSecret: "s", Icon: "sparkles"},
	} {
		if _, err := up(row); code(err) != connect.CodeInvalidArgument {
			t.Errorf("%s: want invalid_argument, got %v", name, err)
		}
	}
	if _, err := up(
		&instancev1.LoginProvider{Id: "dup", Issuer: "https://a.example.com", ClientId: "c", ClientSecret: "s"},
		&instancev1.LoginProvider{Id: "dup", Issuer: "https://b.example.com", ClientId: "c", ClientSecret: "s"},
	); code(err) != connect.CodeInvalidArgument {
		t.Errorf("duplicate ids: want invalid_argument, got %v", err)
	}

	// A saved list overrides the environment.
	res, err := up(&instancev1.LoginProvider{
		Id: "google", DisplayName: "Google", Icon: "google",
		Issuer: "https://accounts.google.com/", ClientId: "gc", ClientSecret: "gs",
	})
	if err != nil {
		t.Fatal(err)
	}
	p = res.Msg.Providers.Providers[0]
	// The issuer survives byte-for-byte: discovery requires an exact
	// match, so a trailing slash (Authentik-style) must be kept.
	if p.Id != "google" || p.FromEnv || p.Issuer != "https://accounts.google.com/" {
		t.Errorf("saved provider = %+v", p)
	}
	if lp, err := svc.LoginProvider(ctx, "google"); err != nil || lp.ClientSecret != "gs" {
		t.Errorf("saved secret = %+v, %v", lp, err)
	}
	if _, err := svc.LoginProvider(ctx, "sso"); code(err) != connect.CodeNotFound {
		t.Errorf("env provider still visible after save: %v", err)
	}

	// Blank secret on resave keeps the saved one — but only while the
	// client id is unchanged.
	if _, err := up(&instancev1.LoginProvider{
		Id: "google", DisplayName: "Google", Icon: "google",
		Issuer: "https://accounts.google.com/", ClientId: "gc",
	}); err != nil {
		t.Fatalf("resave with blank secret: %v", err)
	}
	if lp, _ := svc.LoginProvider(ctx, "google"); lp.ClientSecret != "gs" {
		t.Errorf("secret not carried forward: %+v", lp)
	}
	if _, err := up(&instancev1.LoginProvider{
		Id: "google", DisplayName: "Google", Icon: "google",
		Issuer: "https://accounts.google.com/", ClientId: "different",
	}); code(err) != connect.CodeInvalidArgument {
		t.Errorf("blank secret with new client id: want invalid_argument, got %v", err)
	}

	// Clearing the list falls back to the environment.
	if _, err := up(); err != nil {
		t.Fatal(err)
	}
	got, _ = svc.GetLoginProviders(admin, connect.NewRequest(&instancev1.GetLoginProvidersRequest{}))
	if len(got.Msg.Providers) != 1 || !got.Msg.Providers[0].FromEnv {
		t.Errorf("after clear = %+v", got.Msg.Providers)
	}

	// The public status carries only id, name, and icon.
	st, err := svc.GetInstanceStatus(ctx, connect.NewRequest(&instancev1.GetInstanceStatusRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Msg.LoginProviders) != 1 || st.Msg.LoginProviders[0].Id != "sso" {
		t.Errorf("status providers = %+v", st.Msg.LoginProviders)
	}
}

func TestPasswordSignInSetting(t *testing.T) {
	pool := dbtest.New(t)
	users := newFakeUsers(instance.UserSummary{ID: "a1", Username: "ada", Role: authctx.RoleAdmin})
	svc := instance.New(pool, users)
	admin := as("a1", authctx.RoleAdmin)
	set := func(v instancev1.PasswordSignIn) error {
		_, err := svc.UpdateSettings(admin, connect.NewRequest(&instancev1.UpdateSettingsRequest{PasswordSignIn: &v}))
		return err
	}

	// Default: everyone. No providers: restricting is refused.
	if p, _ := svc.PasswordSignIn(context.Background()); p != string(instance.PasswordEveryone) {
		t.Errorf("default = %q", p)
	}
	if err := set(instancev1.PasswordSignIn_PASSWORD_SIGN_IN_OFF); code(err) != connect.CodeFailedPrecondition {
		t.Errorf("off without providers: want failed_precondition, got %v", err)
	}

	// With a provider it's allowed, and the public status reflects it.
	svc.UseLoginProvidersEnv([]instance.LoginProvider{{ID: "sso", Kind: instance.KindOIDC, DisplayName: "SSO",
		Issuer: "https://idp.example.com", ClientID: "c", ClientSecret: "s"}})
	if err := set(instancev1.PasswordSignIn_PASSWORD_SIGN_IN_ADMINS); err != nil {
		t.Fatal(err)
	}
	st, _ := svc.GetInstanceStatus(context.Background(), connect.NewRequest(&instancev1.GetInstanceStatusRequest{}))
	if st.Msg.PasswordSignIn != instancev1.PasswordSignIn_PASSWORD_SIGN_IN_ADMINS {
		t.Errorf("status password_sign_in = %v", st.Msg.PasswordSignIn)
	}
	if p, _ := svc.PasswordSignIn(context.Background()); p != string(instance.PasswordAdmins) {
		t.Errorf("port = %q", p)
	}
	// The CLI break-glass has no guard.
	if err := svc.SetPasswordSignIn(context.Background(), instance.PasswordEveryone); err != nil {
		t.Fatal(err)
	}
	if err := svc.SetPasswordSignIn(context.Background(), instance.PasswordSignIn("maybe")); err == nil {
		t.Error("bogus value accepted")
	}
}
