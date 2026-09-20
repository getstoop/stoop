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
// GetHealth's row has grown by those calls, the one error, and shows
// timings. The stats are process-wide, so the test reads a delta rather
// than a total: every harness in this package records into them.
func TestE2EDiagnosticsRequests(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	ada := h.person("ada")

	h.rpc(ada, diagnostics+"GetRequestStats", map[string]any{}).expect(t, "permission_denied")
	before := procedureRow(h.rpc(casey, diagnostics+"GetRequestStats", map[string]any{}).expect(t, "ok"), "InstanceService.GetHealth")

	h.rpc(casey, diagnostics+"GetHealth", map[string]any{}).expect(t, "ok")
	h.rpc(casey, diagnostics+"GetHealth", map[string]any{}).expect(t, "ok")
	h.rpc(ada, diagnostics+"GetHealth", map[string]any{}).expect(t, "permission_denied")

	r := h.rpc(casey, diagnostics+"GetRequestStats", map[string]any{}).expect(t, "ok")
	after := procedureRow(r, "InstanceService.GetHealth")
	if after == nil {
		t.Fatalf("no InstanceService.GetHealth row: %s", r.raw)
	}
	if grew := jsonInt(after["calls"]) - jsonInt(before["calls"]); grew < 3 {
		t.Errorf("calls grew by %d, want >= 3", grew)
	}
	if grew := jsonInt(after["errors"]) - jsonInt(before["errors"]); grew < 1 {
		t.Errorf("errors grew by %d, want >= 1", grew)
	}
	if p95 := jsonInt(after["p95Us"]); p95 <= 0 {
		t.Errorf("p95Us = %d, want > 0", p95)
	}
}

// procedureRow finds one procedure's row in a GetRequestStats reply, or
// nil when it has not been called yet; jsonInt reads nil as 0.
func procedureRow(r reply, procedure string) map[string]any {
	for _, p := range r.list("procedures") {
		m, _ := p.(map[string]any)
		if m["procedure"] == procedure {
			return m
		}
	}
	return nil
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
