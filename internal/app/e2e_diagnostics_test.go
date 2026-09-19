package app_test

import (
	"strconv"
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
	for _, proc := range []string{"GetLiveStats", "GetDatabaseStats", "ListJobs"} {
		h.rpc(ada, diagnostics+proc, map[string]any{}).expect(t, "permission_denied")
		h.rpc(casey, diagnostics+proc, map[string]any{}).expect(t, "unimplemented")
	}
}

// The Requests panel counts every unary call, refused ones included:
// after the admin has read health twice and a member was turned away,
// GetHealth shows up in both windows with its calls, an error and timings.
func TestE2EDiagnosticsRequests(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	ada := h.person("ada")

	h.rpc(ada, diagnostics+"GetRequestStats", map[string]any{}).expect(t, "permission_denied")
	h.rpc(casey, diagnostics+"GetHealth", map[string]any{}).expect(t, "ok")
	h.rpc(casey, diagnostics+"GetHealth", map[string]any{}).expect(t, "ok")
	h.rpc(ada, diagnostics+"GetHealth", map[string]any{}).expect(t, "permission_denied")

	for _, window := range []string{"STATS_WINDOW_SINCE_START", "STATS_WINDOW_LAST_5_MINUTES"} {
		r := h.rpc(casey, diagnostics+"GetRequestStats", map[string]any{"window": window}).expect(t, "ok")
		var health map[string]any
		for _, p := range r.list("procedures") {
			m, _ := p.(map[string]any)
			if m["procedure"] == "InstanceService.GetHealth" {
				health = m
			}
		}
		if health == nil {
			t.Errorf("%s: no InstanceService.GetHealth row: %s", window, r.raw)
			continue
		}
		if calls := jsonInt(health["calls"]); calls < 3 {
			t.Errorf("%s: calls = %d, want >= 3", window, calls)
		}
		if errs := jsonInt(health["errors"]); errs < 1 {
			t.Errorf("%s: errors = %d, want >= 1", window, errs)
		}
		if p95 := jsonInt(health["p95Us"]); p95 <= 0 {
			t.Errorf("%s: p95Us = %d, want > 0", window, p95)
		}
	}
}

// jsonInt reads a proto integer, which comes as a number for int32 and
// as a string for int64.
func jsonInt(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case string:
		i, _ := strconv.ParseInt(n, 10, 64)
		return i
	}
	return 0
}
