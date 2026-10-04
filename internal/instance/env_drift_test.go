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
	"github.com/getstoop/stoop/internal/trustedproxy"
)

func TestEnvDrift(t *testing.T) {
	pool := dbtest.New(t)
	users := newFakeUsers(instance.UserSummary{ID: "a1", Username: "ada", Role: authctx.RoleAdmin})
	ctx := context.Background()
	env := instance.ReachabilityEnv{Reachability: instance.Reachability{
		PublicURL: "https://chat.example.com",
		TURN:      instance.TURNRelay{URLs: []string{"turns:t.example.com:5349"}, Username: "u", Credential: "env-cred"},
		Tailscale: instance.TailscaleSettings{Enabled: true, Hostname: "stoop"},
	}}
	// The variables this .env sets; the hostname and password sign-in are
	// left at their defaults.
	set := map[string]bool{
		"STOOP_PUBLIC_URL": true, "STOOP_TURN_URLS": true, "STOOP_TURN_USERNAME": true,
		"STOOP_TURN_CREDENTIAL": true, "STOOP_TAILSCALE": true,
	}
	start := func(env instance.ReachabilityEnv) []string {
		svc := instance.New(pool, users)
		svc.UseReachabilityEnv(env)
		svc.UsePasswordSignInEnv("everyone")
		svc.UseEnvSet(func(name string) bool { return set[name] })
		if err := svc.SeedFromEnv(ctx); err != nil {
			t.Fatal(err)
		}
		drifted, err := svc.EnvDrift(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return drifted
	}

	// Freshly seeded: nothing differs.
	if drifted := start(env); len(drifted) != 0 {
		t.Errorf("first start drifted: %v", drifted)
	}

	// A rotated secret in .env is named, never shown.
	rotated := env
	rotated.TURN.Credential = "rotated"
	if drifted := start(rotated); !slices.Equal(drifted, []string{"STOOP_TURN_CREDENTIAL"}) {
		t.Errorf("rotated credential: %v", drifted)
	}

	// Switching off in .env is drift too.
	switchedOff := env
	switchedOff.Tailscale.Enabled = false
	if drifted := start(switchedOff); !slices.Equal(drifted, []string{"STOOP_TAILSCALE"}) {
		t.Errorf("STOOP_TAILSCALE=false: %v", drifted)
	}

	// Page edits to values .env leaves at a default (hostname, password
	// sign-in) aren't drift; one .env sets is.
	svc := instance.New(pool, users)
	svc.UseReachabilityEnv(env)
	svc.UseLoginProvidersEnv([]instance.LoginProvider{{ID: "sso", Issuer: "https://idp.example.com", ClientID: "c", ClientSecret: "s"}})
	if _, err := svc.UpdateReachability(as("a1", authctx.RoleAdmin), connect.NewRequest(&instancev1.UpdateReachabilityRequest{
		PublicUrl: ptr("https://porch.example.com"),
		Tailscale: &instancev1.TailscaleSettings{Enabled: true, Hostname: "porch"},
	})); err != nil {
		t.Fatal(err)
	}
	if err := svc.SetPasswordSignIn(ctx, instance.PasswordAdmins); err != nil {
		t.Fatal(err)
	}
	if drifted := start(env); !slices.Equal(drifted, []string{"STOOP_PUBLIC_URL"}) {
		t.Errorf("after page edits: %v", drifted)
	}
}

// Trusted proxies are a set, and an OIDC change names its variable.
func TestEnvDriftSetsAndProviders(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO instance_settings (key, value) VALUES
		('trusted_proxies', '["192.168.1.5/32", "10.0.0.0/8"]'),
		('login_providers', '[{"id":"sso","issuer":"https://old.example.com","client_id":"c","client_secret":"s","display_name":"SSO"}]')`); err != nil {
		t.Fatal(err)
	}
	proxies, err := trustedproxy.Parse([]string{"10.0.0.0/8", "192.168.1.5"})
	if err != nil {
		t.Fatal(err)
	}
	svc := instance.New(pool, newFakeUsers())
	svc.UseReachabilityEnv(instance.ReachabilityEnv{Reachability: instance.Reachability{TrustedProxies: proxies}})
	svc.UseLoginProvidersEnv([]instance.LoginProvider{{ID: "sso", Issuer: "https://new.example.com", ClientID: "c", ClientSecret: "s", DisplayName: "SSO"}})
	svc.UseEnvSet(func(string) bool { return true })
	drifted, err := svc.EnvDrift(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(drifted, []string{"STOOP_OIDC_ISSUER"}) {
		t.Errorf("drifted = %v", drifted)
	}
}
