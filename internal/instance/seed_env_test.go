package instance_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/instance"
)

func TestSeedFromEnv(t *testing.T) {
	pool := dbtest.New(t)
	users := newFakeUsers(instance.UserSummary{ID: "a1", Username: "ada", Role: authctx.RoleAdmin})
	admin := as("a1", authctx.RoleAdmin)
	ctx := context.Background()
	env := instance.ReachabilityEnv{Reachability: instance.Reachability{
		TURN:             instance.TURNRelay{URLs: []string{"turns:t.example.com:5349"}, Username: "u", Credential: "env-cred"},
		Tailscale:        instance.TailscaleSettings{Enabled: true, Hostname: "porch", AuthKey: "tskey-env"},
		CloudflareTunnel: instance.CloudflareTunnelSettings{Enabled: true, Token: "env-tunnel-token"},
	}}
	// start is one server start: the environment as .env has it, then the
	// seed step.
	start := func(env instance.ReachabilityEnv) *instance.Service {
		svc := instance.New(pool, users)
		svc.UseReachabilityEnv(env)
		if err := svc.SeedFromEnv(ctx); err != nil {
			t.Fatal(err)
		}
		return svc
	}
	svc := start(env)
	up := func(req *instancev1.UpdateReachabilityRequest) error {
		_, err := svc.UpdateReachability(admin, connect.NewRequest(req))
		return err
	}

	// A changed .env doesn't touch what was seeded.
	changed := env
	changed.TURN.Credential = "rotated"
	changed.PublicURL = "https://later.example.com"
	svc = start(changed)
	inForce, err := svc.Reachability(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if inForce.TURN.Credential != "env-cred" {
		t.Errorf("a changed env replaced the seeded TURN credential: %+v", inForce.TURN)
	}
	// A group with no row is still seeded on a later start.
	if inForce.PublicURL != "https://later.example.com" {
		t.Errorf("a group added to env later wasn't seeded: %q", inForce.PublicURL)
	}

	// A blank secret keeps the seeded one, and saving the switch alone
	// keeps the auth key and tunnel token.
	if err := up(&instancev1.UpdateReachabilityRequest{
		Turn:             &instancev1.TurnRelay{Urls: []string{"turns:t.example.com:5349"}, Username: "u"},
		Tailscale:        &instancev1.TailscaleSettings{Enabled: true, Hostname: "porch", Funnel: true},
		CloudflareTunnel: &instancev1.CloudflareTunnelSettings{Enabled: true},
	}); err != nil {
		t.Fatalf("saving with blank secrets: %v", err)
	}
	if inForce, _ = svc.Reachability(ctx); inForce.TURN.Credential != "env-cred" || inForce.Tailscale.AuthKey != "tskey-env" || inForce.CloudflareTunnel.Token != "env-tunnel-token" {
		t.Errorf("blank secrets lost the seeded ones: %+v", inForce)
	}

	// Clearing TURN and switching off the tunnel survive a restart.
	if err := up(&instancev1.UpdateReachabilityRequest{
		Turn:             &instancev1.TurnRelay{},
		CloudflareTunnel: &instancev1.CloudflareTunnelSettings{Enabled: false},
	}); err != nil {
		t.Fatal(err)
	}
	svc = start(env)
	if inForce, _ = svc.Reachability(ctx); len(inForce.TURN.URLs) != 0 || inForce.TURN.Credential != "" || inForce.CloudflareTunnel.Enabled {
		t.Errorf("cleared settings came back after a restart: %+v", inForce)
	}
}

// With nothing saved (a database wiped under a running server), the
// environment is what's in force, and a blank secret keeps its value.
func TestBlankSecretKeepsEnvValue(t *testing.T) {
	svc := instance.New(dbtest.New(t), newFakeUsers(instance.UserSummary{ID: "a1", Username: "ada", Role: authctx.RoleAdmin}))
	svc.UseReachabilityEnv(instance.ReachabilityEnv{Reachability: instance.Reachability{
		TURN:      instance.TURNRelay{URLs: []string{"turns:t.example.com:5349"}, Username: "u", Credential: "env-cred"},
		Tailscale: instance.TailscaleSettings{Enabled: true, AuthKey: "tskey-env"},
	}})
	admin := as("a1", authctx.RoleAdmin)
	ctx := context.Background()
	got, err := svc.GetReachability(admin, connect.NewRequest(&instancev1.GetReachabilityRequest{}))
	if err != nil || !got.Msg.Reachability.Turn.HasCredential {
		t.Fatalf("env credential should show as set: %v %+v", err, got)
	}
	if _, err := svc.UpdateReachability(admin, connect.NewRequest(&instancev1.UpdateReachabilityRequest{
		Turn:      &instancev1.TurnRelay{Urls: []string{"turns:t.example.com:5349"}, Username: "u"},
		Tailscale: &instancev1.TailscaleSettings{Enabled: true, Hostname: "porch"},
	})); err != nil {
		t.Fatalf("blank secret with the value from env: %v", err)
	}
	if inForce, _ := svc.Reachability(ctx); inForce.TURN.Credential != "env-cred" || inForce.Tailscale.AuthKey != "tskey-env" {
		t.Errorf("first save dropped the env secrets: %+v", inForce)
	}
}

// A save refused on one field writes none of the others (STOOP-357).
func TestRefusedSaveWritesNothing(t *testing.T) {
	svc := instance.New(dbtest.New(t), newFakeUsers(instance.UserSummary{ID: "a1", Username: "ada", Role: authctx.RoleAdmin}))
	admin := as("a1", authctx.RoleAdmin)
	ctx := context.Background()
	ts := &fakeTailscale{}
	if err := svc.UseTailscale(ctx, ts); err != nil {
		t.Fatal(err)
	}
	ts.applied = nil

	if _, err := svc.UpdateReachability(admin, connect.NewRequest(&instancev1.UpdateReachabilityRequest{
		PublicUrl: ptr("https://chat.example.com"),
		Tailscale: &instancev1.TailscaleSettings{Enabled: true, Hostname: "porch"},
		Turn:      &instancev1.TurnRelay{Urls: []string{"turns:t.example.com:5349"}},
	})); code(err) != connect.CodeInvalidArgument {
		t.Fatalf("TURN without credentials: want invalid_argument, got %v", err)
	}
	if inForce, _ := svc.Reachability(ctx); inForce.PublicURL != "" || inForce.Tailscale.Enabled {
		t.Errorf("a refused reachability save half-applied: %+v", inForce)
	}
	if ts.applied != nil {
		t.Errorf("a refused save restarted the Tailscale node: %+v", ts.applied)
	}

	name := "The Bramblewood"
	quota, perFile := int64(10<<20), int64(20<<20)
	if _, err := svc.UpdateSettings(admin, connect.NewRequest(&instancev1.UpdateSettingsRequest{
		InstanceName: &name, StorageQuotaBytes: &quota, MaxUploadBytes: &perFile,
	})); code(err) != connect.CodeInvalidArgument {
		t.Fatalf("per-file cap over the quota: want invalid_argument, got %v", err)
	}
	if got, _ := svc.InstanceName(ctx); got == name {
		t.Error("a refused settings save renamed the server")
	}
	if got, _ := svc.StorageQuotaBytes(ctx); got != 0 {
		t.Errorf("a refused settings save set the quota: %d", got)
	}
}

// A tunnel switch saved with a blank token, before seeding, keeps working
// on the environment's token.
func TestSeedFillsBlankTunnelToken(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO instance_settings (key, value) VALUES ('cloudflare_tunnel', '{"enabled":true,"token":""}')`); err != nil {
		t.Fatal(err)
	}
	svc := instance.New(pool, newFakeUsers())
	svc.UseReachabilityEnv(instance.ReachabilityEnv{Reachability: instance.Reachability{
		CloudflareTunnel: instance.CloudflareTunnelSettings{Enabled: true, Token: "env-tunnel-token"},
	}})
	if err := svc.SeedFromEnv(ctx); err != nil {
		t.Fatal(err)
	}
	if inForce, _ := svc.Reachability(ctx); !inForce.CloudflareTunnel.Enabled || inForce.CloudflareTunnel.Token != "env-tunnel-token" {
		t.Errorf("tunnel after upgrade = %+v", inForce.CloudflareTunnel)
	}
}

// An empty provider list saved when clearing fell back to STOOP_OIDC_*
// gets the environment's provider back when password sign-in is
// restricted; with password sign-in open, the empty list is kept.
func TestSeedFillsLegacyEmptyProviders(t *testing.T) {
	ctx := context.Background()
	envProvider := []instance.LoginProvider{{
		ID: "sso", Kind: instance.KindOIDC, DisplayName: "Single sign-on", Icon: "key",
		Issuer: "https://idp.example.com", ClientID: "c", ClientSecret: "s",
	}}
	for _, password := range []string{"off", "everyone"} {
		pool := dbtest.New(t)
		if _, err := pool.Exec(ctx, `INSERT INTO instance_settings (key, value) VALUES ('login_providers', '[]'), ('password_sign_in', to_jsonb($1::text))`, password); err != nil {
			t.Fatal(err)
		}
		svc := instance.New(pool, newFakeUsers())
		svc.UseLoginProvidersEnv(envProvider)
		if err := svc.SeedFromEnv(ctx); err != nil {
			t.Fatal(err)
		}
		providers, err := svc.LoginProviders(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if want := map[string]int{"off": 1, "everyone": 0}[password]; len(providers) != want {
			t.Errorf("password %s: %d providers, want %d", password, len(providers), want)
		}
	}

	// Once repaired, a list cleared later stays cleared, even when the
	// shell then restricts password sign-in past the page's check.
	pool := dbtest.New(t)
	svc := instance.New(pool, newFakeUsers())
	svc.UseLoginProvidersEnv(envProvider)
	if err := svc.SeedFromEnv(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateLoginProviders(as("a1", authctx.RoleAdmin), connect.NewRequest(&instancev1.UpdateLoginProvidersRequest{})); err != nil {
		t.Fatal(err)
	}
	if err := svc.SetPasswordSignIn(ctx, instance.PasswordOff); err != nil {
		t.Fatal(err)
	}
	if err := svc.SeedFromEnv(ctx); err != nil {
		t.Fatal(err)
	}
	if providers, _ := svc.LoginProviders(ctx); len(providers) != 0 {
		t.Errorf("a later clear was undone at restart: %+v", providers)
	}
}
