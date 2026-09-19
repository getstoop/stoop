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
	for _, proc := range []string{"ListJobs"} {
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

// Right now and Database: the gauges the app registers, with the sampler's
// step, and the pool and catalog facts of the harness's own database.
func TestE2EDiagnosticsLiveAndDatabase(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	ada := h.person("ada")

	h.rpc(ada, diagnostics+"GetLiveStats", map[string]any{}).expect(t, "permission_denied")
	live := h.rpc(casey, diagnostics+"GetLiveStats", map[string]any{}).expect(t, "ok")
	if live.str("at") == "" || liveNumber(live, "stepSeconds") != 10 {
		t.Errorf("live stats header: %s", live.raw)
	}
	gauges := map[string]bool{}
	for _, g := range live.list("gauges") {
		m, _ := g.(map[string]any)
		name, _ := m["name"].(string)
		gauges[name] = true
	}
	for _, want := range []string{"connections", "online_users", "voice_participants", "voice_rooms", "bus_dropped_total"} {
		if !gauges[want] {
			t.Errorf("no %s gauge in %v", want, gauges)
		}
	}

	h.rpc(ada, diagnostics+"GetDatabaseStats", map[string]any{}).expect(t, "permission_denied")
	dbs := h.rpc(casey, diagnostics+"GetDatabaseStats", map[string]any{}).expect(t, "ok")
	if liveNumber(dbs, "poolMax") <= 0 || liveNumber(dbs, "pingUs") <= 0 || dbs.str("serverVersion") == "" {
		t.Errorf("database stats: %s", dbs.raw)
	}
	// Connect's JSON writes int64 as a string.
	if v, _ := strconv.Atoi(dbs.str("schemaVersion")); v <= 0 {
		t.Errorf("schemaVersion = %q, want > 0: %s", dbs.str("schemaVersion"), dbs.raw)
	}
	if v, _ := strconv.Atoi(dbs.str("databaseBytes")); v <= 0 {
		t.Errorf("databaseBytes = %q, want > 0", dbs.str("databaseBytes"))
	}
}

// liveNumber reads a JSON number at a top-level key, 0 when absent.
func liveNumber(r reply, key string) float64 {
	v, _ := r.body[key].(float64)
	return v
}
