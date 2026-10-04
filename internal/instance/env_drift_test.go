package instance_test

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/instance"
)

func TestEnvDrift(t *testing.T) {
	pool := dbtest.New(t)
	users := newFakeUsers(instance.UserSummary{ID: "a1", Username: "ada", Role: authctx.RoleAdmin})
	ctx := context.Background()
	env := instance.ReachabilityEnv{Reachability: instance.Reachability{
		PublicURL: "https://chat.example.com",
		TURN:      instance.TURNRelay{URLs: []string{"turns:t.example.com:5349"}, Username: "u", Credential: "env-cred"},
		Tailscale: instance.TailscaleSettings{Enabled: true, Hostname: config.DefaultTailscaleHostname},
	}}
	start := func(env instance.ReachabilityEnv) []string {
		svc := instance.New(pool, users)
		svc.UseReachabilityEnv(env)
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

	// A setting changed on the page, where .env leaves the default (the
	// hostname) or says nothing, isn't drift; one .env does set is.
	svc := instance.New(pool, users)
	svc.UseReachabilityEnv(env)
	if _, err := svc.UpdateReachability(as("a1", authctx.RoleAdmin), connect.NewRequest(&instancev1.UpdateReachabilityRequest{
		PublicUrl: ptr("https://porch.example.com"),
		Tailscale: &instancev1.TailscaleSettings{Enabled: true, Hostname: "porch"},
	})); err != nil {
		t.Fatal(err)
	}
	if drifted := start(env); !slices.Equal(drifted, []string{"STOOP_PUBLIC_URL"}) {
		t.Errorf("after page edits: %v", drifted)
	}
}
