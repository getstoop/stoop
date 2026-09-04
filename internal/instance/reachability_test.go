package instance_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	instancev1 "github.com/Jhut89/stoop/gen/stoop/instance/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/db/dbtest"
	"github.com/Jhut89/stoop/internal/instance"
	"github.com/Jhut89/stoop/internal/trustedproxy"
)

func TestReachability(t *testing.T) {
	pool := dbtest.New(t)
	users := newFakeUsers(instance.UserSummary{ID: "a1", Username: "ada", Role: authctx.RoleAdmin})
	svc := instance.New(pool, users)
	svc.UseReachabilityEnv(instance.ReachabilityEnv{
		Reachability: instance.Reachability{
			PublicURL:  "https://env.example.com",
			Cloudflare: instance.CloudflareTURN{KeyID: "env-key", APIToken: "env-token"},
		},
		VoiceConfigured: true,
	})
	svc.UsePublicURL(func() string { return "https://stoop.tailnet.ts.net" })
	admin, member := as("a1", authctx.RoleAdmin), as("m1", authctx.RoleMember)
	ctx := context.Background()

	// Members can't see or change it.
	if _, err := svc.GetReachability(member, connect.NewRequest(&instancev1.GetReachabilityRequest{})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member GetReachability: %v", err)
	}

	// Nothing saved: the environment shows through, secrets never do.
	got, err := svc.GetReachability(admin, connect.NewRequest(&instancev1.GetReachabilityRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	r := got.Msg.Reachability
	if r.PublicUrl != "https://env.example.com" || r.Cloudflare.KeyId != "env-key" || !r.Cloudflare.HasApiToken || r.Cloudflare.ApiToken != "" || !got.Msg.VoiceConfigured {
		t.Errorf("env fallback = %+v", got.Msg)
	}
	if pu, _ := svc.PublicURL(ctx); pu != "https://env.example.com" {
		t.Errorf("PublicURL env fallback = %q", pu)
	}

	// Save a public URL: it wins over the environment; a bad one is rejected.
	up := func(req *instancev1.UpdateReachabilityRequest) (*instancev1.GetReachabilityResponse, error) {
		res, err := svc.UpdateReachability(admin, connect.NewRequest(req))
		if err != nil {
			return nil, err
		}
		return res.Msg.Reachability, nil
	}
	if _, err := up(&instancev1.UpdateReachabilityRequest{PublicUrl: ptr("chat.example.com")}); code(err) != connect.CodeInvalidArgument {
		t.Errorf("bare host should be rejected: %v", err)
	}
	res, err := up(&instancev1.UpdateReachabilityRequest{PublicUrl: ptr("https://chat.example.com/")})
	if err != nil || res.Reachability.PublicUrl != "https://chat.example.com" {
		t.Errorf("saved public url: %v %+v", err, res)
	}
	if pu, _ := svc.PublicURL(ctx); pu != "https://chat.example.com" {
		t.Errorf("PublicURL saved = %q", pu)
	}
	st, _ := svc.GetInstanceStatus(ctx, connect.NewRequest(&instancev1.GetInstanceStatusRequest{}))
	if st.Msg.PublicUrl != "https://chat.example.com" {
		t.Errorf("status public_url = %q", st.Msg.PublicUrl)
	}
	// Clearing falls back to the environment; with no env it falls back to
	// the tailnet address.
	res, _ = up(&instancev1.UpdateReachabilityRequest{PublicUrl: ptr("")})
	if res.Reachability.PublicUrl != "https://env.example.com" {
		t.Errorf("cleared public url should fall back to env, got %q", res.Reachability.PublicUrl)
	}
	svc.UseReachabilityEnv(instance.ReachabilityEnv{})
	if pu, _ := svc.PublicURL(ctx); pu != "https://stoop.tailnet.ts.net" {
		t.Errorf("PublicURL tailnet fallback = %q", pu)
	}

	// TURN: validated, credential write-only.
	if _, err := up(&instancev1.UpdateReachabilityRequest{Turn: &instancev1.TurnRelay{Urls: []string{"turns:t.example.com:5349"}}}); code(err) != connect.CodeInvalidArgument {
		t.Errorf("TURN without credentials should be rejected: %v", err)
	}
	if _, err := up(&instancev1.UpdateReachabilityRequest{Turn: &instancev1.TurnRelay{Urls: []string{"http://nope"}, Username: "u", Credential: "p"}}); code(err) != connect.CodeInvalidArgument {
		t.Errorf("non-turn URL should be rejected: %v", err)
	}
	res, err = up(&instancev1.UpdateReachabilityRequest{Turn: &instancev1.TurnRelay{
		Urls: []string{" turns:t.example.com:5349 "}, Username: "u", Credential: "p", StunUrls: []string{"stun:t.example.com:3478"},
	}})
	if err != nil || res.Reachability.Turn.Urls[0] != "turns:t.example.com:5349" || !res.Reachability.Turn.HasCredential || res.Reachability.Turn.Credential != "" {
		t.Errorf("saved TURN: %v %+v", err, res.Reachability.Turn)
	}
	eff, _ := svc.Reachability(ctx)
	if eff.TURN.Credential != "p" || len(eff.TURN.STUNURLs) != 1 {
		t.Errorf("effective TURN = %+v", eff.TURN)
	}
	// Re-saving with a blank credential (the form never echoes it) keeps it.
	if _, err := up(&instancev1.UpdateReachabilityRequest{Turn: &instancev1.TurnRelay{
		Urls: []string{"turns:t.example.com:5349"}, Username: "u",
	}}); err != nil {
		t.Errorf("blank credential must keep the saved one: %v", err)
	}
	if eff, _ = svc.Reachability(ctx); eff.TURN.Credential != "p" {
		t.Errorf("credential lost on re-save: %+v", eff.TURN)
	}

	// Cloudflare: token write-only and kept when only the key id is resent;
	// a new key needs a token; empty key clears.
	if _, err := up(&instancev1.UpdateReachabilityRequest{Cloudflare: &instancev1.CloudflareTurn{KeyId: "k1"}}); code(err) != connect.CodeInvalidArgument {
		t.Errorf("new key without token should be rejected: %v", err)
	}
	if _, err := up(&instancev1.UpdateReachabilityRequest{Cloudflare: &instancev1.CloudflareTurn{KeyId: "k1", ApiToken: "t1"}}); err != nil {
		t.Fatal(err)
	}
	res, err = up(&instancev1.UpdateReachabilityRequest{Cloudflare: &instancev1.CloudflareTurn{KeyId: "k1"}})
	if err != nil || !res.Reachability.Cloudflare.HasApiToken {
		t.Errorf("resending the key id must keep the token: %v %+v", err, res.Reachability.Cloudflare)
	}
	if eff, _ = svc.Reachability(ctx); eff.Cloudflare.APIToken != "t1" {
		t.Errorf("effective cloudflare = %+v", eff.Cloudflare)
	}
	res, _ = up(&instancev1.UpdateReachabilityRequest{Cloudflare: &instancev1.CloudflareTurn{}})
	if res.Reachability.Cloudflare.KeyId != "" || res.Reachability.Cloudflare.HasApiToken {
		t.Errorf("clearing cloudflare: %+v", res.Reachability.Cloudflare)
	}

	// Tailscale status comes from the port; absent port = not enabled.
	if res.Tailscale.Enabled {
		t.Error("tailscale should report disabled without a port")
	}
	ctrl := &fakeTailscale{}
	if err := svc.UseTailscale(ctx, ctrl); err != nil {
		t.Fatal(err)
	}
	if ctrl.applied == nil || ctrl.applied.Enabled {
		t.Errorf("connecting the controller must apply the settings in force (disabled): %+v", ctrl.applied)
	}
	got, _ = svc.GetReachability(admin, connect.NewRequest(&instancev1.GetReachabilityRequest{}))
	if !got.Msg.Tailscale.Enabled || got.Msg.Tailscale.State != "needs_login" || got.Msg.Tailscale.LoginUrl == "" {
		t.Errorf("tailscale status = %+v", got.Msg.Tailscale)
	}

	// Saving Tailscale settings applies them; the auth key is write-only and
	// kept when left blank; bad hostnames are rejected.
	if _, err := up(&instancev1.UpdateReachabilityRequest{Tailscale: &instancev1.TailscaleSettings{Enabled: true, Hostname: "bad name"}}); code(err) != connect.CodeInvalidArgument {
		t.Errorf("hostname with a space should be rejected: %v", err)
	}
	res, err = up(&instancev1.UpdateReachabilityRequest{Tailscale: &instancev1.TailscaleSettings{Enabled: true, Hostname: "porch", AuthKey: "tskey-x", Funnel: false}})
	if err != nil || !res.Reachability.Tailscale.Enabled || res.Reachability.Tailscale.Hostname != "porch" || !res.Reachability.Tailscale.HasAuthKey || res.Reachability.Tailscale.AuthKey != "" {
		t.Errorf("saved tailscale: %v %+v", err, res.Reachability.Tailscale)
	}
	if ctrl.applied == nil || !ctrl.applied.Enabled || ctrl.applied.Hostname != "porch" || ctrl.applied.AuthKey != "tskey-x" {
		t.Errorf("controller not applied: %+v", ctrl.applied)
	}
	res, _ = up(&instancev1.UpdateReachabilityRequest{Tailscale: &instancev1.TailscaleSettings{Enabled: true, Hostname: "porch", Funnel: true}})
	if !res.Reachability.Tailscale.HasAuthKey || ctrl.applied.AuthKey != "tskey-x" || !ctrl.applied.Funnel {
		t.Errorf("blank auth key must keep the saved one: %+v / %+v", res.Reachability.Tailscale, ctrl.applied)
	}
	res, _ = up(&instancev1.UpdateReachabilityRequest{Tailscale: &instancev1.TailscaleSettings{Enabled: false}})
	if res.Reachability.Tailscale.Enabled || ctrl.applied.Enabled {
		t.Errorf("disable not applied: %+v", ctrl.applied)
	}

	// A running node reports its tailnet address and whether it is
	// carrying LiveKit's media ports, which is what the page needs to
	// tell the truth about voice.
	ctrl.status = &instance.TailscaleStatus{
		Enabled: true, State: "running", URL: "https://porch.example.ts.net",
		TailnetIP: "100.64.1.2", CarriesVoice: true,
	}
	got, _ = svc.GetReachability(admin, connect.NewRequest(&instancev1.GetReachabilityRequest{}))
	if got.Msg.Tailscale.TailnetIp != "100.64.1.2" || !got.Msg.Tailscale.CarriesVoice {
		t.Errorf("tailnet address and voice carriage should reach the API: %+v", got.Msg.Tailscale)
	}
}

type fakeTailscale struct {
	applied *instance.TailscaleSettings
	status  *instance.TailscaleStatus
}

func (f *fakeTailscale) Apply(s instance.TailscaleSettings) { f.applied = &s }
func (f *fakeTailscale) Status(context.Context) instance.TailscaleStatus {
	if f.status != nil {
		return *f.status
	}
	return instance.TailscaleStatus{Enabled: true, State: "needs_login", LoginURL: "https://login.tailscale.com/a/x"}
}

func ptr(s string) *string { return &s }

// Trusted proxies: saved addresses decide whose forwarded headers count,
// a save takes effect immediately (no restart), and the older
// trust-everything environment flag is the fallback.
func TestTrustedProxies(t *testing.T) {
	pool := dbtest.New(t)
	users := newFakeUsers(instance.UserSummary{ID: "a1", Username: "ada", Role: authctx.RoleAdmin})
	svc := instance.New(pool, users)
	svc.UseReachabilityEnv(instance.ReachabilityEnv{VoiceConfigured: true})
	admin := as("a1", authctx.RoleAdmin)
	ctx := context.Background()
	if err := svc.LoadTrustedProxies(ctx); err != nil {
		t.Fatal(err)
	}

	// Nothing configured: nobody is trusted.
	for _, peer := range []string{"10.0.0.2:5000", "127.0.0.1:5000"} {
		if svc.TrustsPeer(peer) {
			t.Errorf("trusted %s with nothing configured", peer)
		}
	}

	// Saving names them, and applies without a restart.
	if _, err := svc.UpdateReachability(admin, connect.NewRequest(&instancev1.UpdateReachabilityRequest{
		TrustedProxies: &instancev1.TrustedProxies{Cidrs: []string{"10.0.0.0/8", "192.168.1.5"}},
	})); err != nil {
		t.Fatal(err)
	}
	if !svc.TrustsPeer("10.4.4.4:1234") || !svc.TrustsPeer("192.168.1.5:80") {
		t.Error("named proxies are not trusted after saving")
	}
	if svc.TrustsPeer("8.8.8.8:80") || svc.TrustsPeer("192.168.1.6:80") {
		t.Error("an address that wasn't named is trusted")
	}
	got, err := svc.GetReachability(admin, connect.NewRequest(&instancev1.GetReachabilityRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if list := got.Msg.Reachability.TrustedProxies; list == nil ||
		len(list.Cidrs) != 2 || list.Cidrs[0] != "10.0.0.0/8" || list.Cidrs[1] != "192.168.1.5" || list.TrustAll {
		t.Errorf("round trip: %v", got.Msg.Reachability.TrustedProxies)
	}

	// Junk is refused, and the saved list survives the attempt.
	if _, err := svc.UpdateReachability(admin, connect.NewRequest(&instancev1.UpdateReachabilityRequest{
		TrustedProxies: &instancev1.TrustedProxies{Cidrs: []string{"proxy.example.com"}},
	})); code(err) != connect.CodeInvalidArgument {
		t.Errorf("hostname accepted as a proxy address: %v", err)
	}
	if !svc.TrustsPeer("10.4.4.4:1234") {
		t.Error("a refused save changed the list")
	}

	// Clearing falls back to the environment, which here trusts everyone.
	env := svc.ReachabilityEnvValue()
	env.TrustedProxies = trustedproxy.All()
	svc.UseReachabilityEnv(env)
	if _, err := svc.UpdateReachability(admin, connect.NewRequest(&instancev1.UpdateReachabilityRequest{
		TrustedProxies: &instancev1.TrustedProxies{},
	})); err != nil {
		t.Fatal(err)
	}
	if !svc.TrustsPeer("8.8.8.8:80") {
		t.Error("cleared list should fall back to STOOP_TRUST_PROXY")
	}
	got, err = svc.GetReachability(admin, connect.NewRequest(&instancev1.GetReachabilityRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if !got.Msg.Reachability.TrustedProxies.TrustAll {
		t.Error("trust_all should be reported when the environment trusts everyone")
	}

	// Saving something else leaves the proxies alone.
	if _, err := svc.UpdateReachability(admin, connect.NewRequest(&instancev1.UpdateReachabilityRequest{
		PublicUrl: ptr("https://chat.example.com"),
	})); err != nil {
		t.Fatal(err)
	}
	if !svc.TrustsPeer("8.8.8.8:80") {
		t.Error("an unrelated save disturbed the trusted proxies")
	}
}
