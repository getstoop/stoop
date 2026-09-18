package app_test

import (
	"encoding/base64"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/cftunnel/cftunneltest"
)

// Run as the fake cloudflared when the connector starts this binary.
func TestMain(m *testing.M) {
	if os.Getenv(cftunneltest.Env) != "" {
		cftunneltest.Main()
	}
	os.Exit(m.Run())
}

const reachability = "stoop.instance.v1.InstanceService/"

// The Cloudflare Tunnel: an admin turns it on with a token, the connector
// runs, and turning it off stops it. The public address is the operator's
// to fill in; the tunnel never sets it.
func TestE2ECloudflareTunnel(t *testing.T) {
	path := cftunneltest.Use(t, "ok")
	h := newHarness(t, "STOOP_CLOUDFLARED_PATH", path)
	casey := h.person("casey")
	ada := h.person("ada")
	token := base64.StdEncoding.EncodeToString([]byte(`{"a":"0123456789abcdef0123456789abcdef","t":"11111111-2222-3333-4444-555555555555","s":"c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0"}`))
	on := func(v any) map[string]any { return map[string]any{"cloudflareTunnel": v} }

	r := h.rpc(casey, reachability+"GetReachability", map[string]any{}).expect(t, "ok")
	if r.str("cloudflareTunnel.state") != "stopped" {
		t.Errorf("before: %s", r.raw)
	}

	h.rpc(ada, reachability+"UpdateReachability", on(map[string]any{"enabled": true, "token": token})).
		expect(t, "permission_denied")
	h.rpc(casey, reachability+"UpdateReachability", on(map[string]any{"enabled": true})).
		expect(t, "invalid_argument", "needs the tunnel's token")
	h.rpc(casey, reachability+"UpdateReachability", on(map[string]any{"enabled": true, "token": "not-a-token"})).
		expect(t, "invalid_argument", "isn't a tunnel token")

	// Saved, and the token never comes back.
	r = h.rpc(casey, reachability+"UpdateReachability",
		on(map[string]any{"enabled": true, "token": token})).expect(t, "ok")
	if !strings.Contains(r.raw, `"hasToken":true`) {
		t.Errorf("after save: %s", r.raw)
	}
	if strings.Contains(r.raw, token) {
		t.Errorf("the token came back: %s", r.raw)
	}

	h.waitTunnel(casey, "running")
	status := h.rpc("", reachability+"GetInstanceStatus", map[string]any{}).expect(t, "ok")
	if status.str("publicUrl") != "" {
		t.Errorf("the tunnel must not set the public address: %s", status.raw)
	}

	// Off: a blank token keeps the saved one.
	h.rpc(casey, reachability+"UpdateReachability", on(map[string]any{"enabled": false})).expect(t, "ok")
	h.waitTunnel(casey, "stopped")
	h.rpc(casey, reachability+"UpdateReachability", on(map[string]any{"enabled": true})).expect(t, "ok")
	h.waitTunnel(casey, "running")
}

// A token from .env is shown as present, and switching the tunnel on from
// the API without retyping it uses it.
func TestE2ECloudflareTunnelEnvToken(t *testing.T) {
	path := cftunneltest.Use(t, "ok")
	token := base64.StdEncoding.EncodeToString([]byte(`{"a":"0123456789abcdef0123456789abcdef","t":"11111111-2222-3333-4444-555555555555","s":"c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0"}`))
	h := newHarness(t, "STOOP_CLOUDFLARED_PATH", path, "STOOP_CLOUDFLARE_TUNNEL_TOKEN", token)
	casey := h.person("casey")

	r := h.rpc(casey, reachability+"GetReachability", map[string]any{}).expect(t, "ok")
	if !strings.Contains(r.raw, `"hasToken":true`) || r.str("cloudflareTunnel.state") != "stopped" {
		t.Errorf("before: %s", r.raw)
	}
	h.rpc(casey, reachability+"UpdateReachability",
		map[string]any{"cloudflareTunnel": map[string]any{"enabled": true}}).expect(t, "ok")
	h.waitTunnel(casey, "running")
	h.rpc(casey, reachability+"UpdateReachability",
		map[string]any{"cloudflareTunnel": map[string]any{"enabled": false}}).expect(t, "ok")
	r = h.waitTunnel(casey, "stopped")
	if !strings.Contains(r.raw, `"hasToken":true`) {
		t.Errorf("after off: %s", r.raw)
	}
}

func TestE2ECloudflareTunnelMissing(t *testing.T) {
	h := newHarness(t, "STOOP_CLOUDFLARED_PATH", "/nonexistent/cloudflared")
	casey := h.person("casey")
	r := h.rpc(casey, reachability+"GetReachability", map[string]any{}).expect(t, "ok")
	if r.str("cloudflareTunnel.state") != "missing" {
		t.Errorf("state: %s", r.raw)
	}
}

func (h *harness) waitTunnel(token, state string) reply {
	h.t.Helper()
	var r reply
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		r = h.rpc(token, reachability+"GetReachability", map[string]any{}).expect(h.t, "ok")
		if r.str("cloudflareTunnel.state") == state {
			return r
		}
	}
	h.t.Fatalf("tunnel never reached %s: %s", state, r.raw)
	return r
}
