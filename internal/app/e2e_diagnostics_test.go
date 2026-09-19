package app_test

import (
	"strings"
	"testing"
)

const diagnostics = "stoop.instance.v1.InstanceService/"

// The Diagnostics tab is the admin's: a member is refused at the door,
// and the admin sees one row per dependency with the harness's shape
// (Postgres up, no LiveKit, a writable upload directory).
func TestE2EDiagnosticsHealth(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	ada := h.person("ada")

	h.rpc(ada, diagnostics+"GetHealth", map[string]any{}).expect(t, "permission_denied")
	r := h.rpc(casey, diagnostics+"GetHealth", map[string]any{}).expect(t, "ok")
	if r.str("serverStartedAt") == "" {
		t.Errorf("no serverStartedAt: %s", r.raw)
	}
	rows := map[string]map[string]any{}
	var order []string
	for _, c := range r.list("checks") {
		m, _ := c.(map[string]any)
		name, _ := m["name"].(string)
		rows[name] = m
		order = append(order, name)
	}
	if strings.Join(order, ",") != "postgres,livekit,storage,public_address" {
		t.Errorf("check order = %v", order)
	}
	if pg := rows["postgres"]; pg["state"] != "CHECK_STATE_OK" || !strings.Contains(pg["detail"].(string), "pool") || pg["checkedAt"] == "" {
		t.Errorf("postgres = %v", pg)
	}
	if lk := rows["livekit"]; lk["state"] != "CHECK_STATE_OFF" || lk["fixTab"] != "hosting" {
		t.Errorf("livekit = %v", lk)
	}
	if st := rows["storage"]; st["state"] != "CHECK_STATE_OK" || !strings.Contains(st["detail"].(string), "writable") || st["fixTab"] != "storage" {
		t.Errorf("storage = %v", st)
	}
	if pa := rows["public_address"]; pa["state"] != "CHECK_STATE_OFF" || pa["fixTab"] != "hosting" {
		t.Errorf("public_address = %v", pa)
	}

	// The panels that are not built yet say so, but only to an admin.
	for _, proc := range []string{"GetLiveStats", "GetDatabaseStats", "GetRequestStats", "ListJobs"} {
		h.rpc(ada, diagnostics+proc, map[string]any{}).expect(t, "permission_denied")
		h.rpc(casey, diagnostics+proc, map[string]any{}).expect(t, "unimplemented")
	}
}
