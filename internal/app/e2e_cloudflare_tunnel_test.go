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
// runs, the public address follows the tunnel's hostname, and turning it
// off takes both away.
func TestE2ECloudflareTunnel(t *testing.T) {
	path := cftunneltest.Use(t, "ok", "8080")
	h := newHarness(t, "STOOP_CLOUDFLARED_PATH", path, "STOOP_LISTEN_ADDR", ":8080")
	casey := h.person("casey")
	ada := h.person("ada")
	token := base64.StdEncoding.EncodeToString([]byte(`{"a":"account","t":"tunnel","s":"secret"}`))
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

	// The whole pasted command is accepted, and the token never comes back.
	r = h.rpc(casey, reachability+"UpdateReachability",
		on(map[string]any{"enabled": true, "token": "sudo cloudflared service install " + token})).expect(t, "ok")
	if !strings.Contains(r.raw, `"hasToken":true`) {
		t.Errorf("after save: %s", r.raw)
	}
	if strings.Contains(r.raw, token) {
		t.Errorf("the token came back: %s", r.raw)
	}

	h.waitTunnel(casey, "running")
	status := h.rpc("", reachability+"GetInstanceStatus", map[string]any{}).expect(t, "ok")
	if status.str("publicUrl") != "https://"+cftunneltest.Hostname {
		t.Errorf("public address while running: %s", status.raw)
	}

	// A saved address still wins.
	h.rpc(casey, reachability+"UpdateReachability", map[string]any{"publicUrl": "https://porch.example.org"}).expect(t, "ok")
	status = h.rpc("", reachability+"GetInstanceStatus", map[string]any{}).expect(t, "ok")
	if status.str("publicUrl") != "https://porch.example.org" {
		t.Errorf("saved address: %s", status.raw)
	}
	h.rpc(casey, reachability+"UpdateReachability", map[string]any{"publicUrl": ""}).expect(t, "ok")

	// Off: a blank token keeps the saved one, and the address goes.
	h.rpc(casey, reachability+"UpdateReachability", on(map[string]any{"enabled": false})).expect(t, "ok")
	r = h.waitTunnel(casey, "stopped")
	if r.str("cloudflareTunnel.url") != "" {
		t.Errorf("after off: %s", r.raw)
	}
	status = h.rpc("", reachability+"GetInstanceStatus", map[string]any{}).expect(t, "ok")
	if status.str("publicUrl") != "" {
		t.Errorf("public address after off: %s", status.raw)
	}
	h.rpc(casey, reachability+"UpdateReachability", on(map[string]any{"enabled": true})).expect(t, "ok")
	h.waitTunnel(casey, "running")
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
