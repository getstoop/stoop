package app_test

import (
	"net/http"
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
	if strings.Join(order, ",") != "postgres,livekit,storage,public_address,webhooks,jobs" {
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
	// Nothing has been hooked up on a fresh instance, so the queue is off,
	// not empty; the loops have started and none is due yet.
	if wh := rows["webhooks"]; wh["state"] != "CHECK_STATE_OFF" || wh["fixTab"] != "integrations" || wh["detail"] != "no outgoing webhooks" {
		t.Errorf("webhooks = %v", wh)
	}
	if jb := rows["jobs"]; jb["state"] != "CHECK_STATE_OK" || !strings.Contains(jb["detail"].(string), "6 jobs on schedule") {
		t.Errorf("jobs = %v", jb)
	}

}

// The Requests panel counts every unary call, refused ones included:
// after the admin has read health twice and a member was turned away,
// GetHealth shows up with its calls, an error and timings.
func TestE2EDiagnosticsRequests(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	ada := h.person("ada")

	h.rpc(ada, diagnostics+"GetRequestStats", map[string]any{}).expect(t, "permission_denied")
	h.rpc(casey, diagnostics+"GetHealth", map[string]any{}).expect(t, "ok")
	h.rpc(casey, diagnostics+"GetHealth", map[string]any{}).expect(t, "ok")
	h.rpc(ada, diagnostics+"GetHealth", map[string]any{}).expect(t, "permission_denied")

	r := h.rpc(casey, diagnostics+"GetRequestStats", map[string]any{}).expect(t, "ok")
	var health map[string]any
	for _, p := range r.list("procedures") {
		m, _ := p.(map[string]any)
		if m["procedure"] == "InstanceService.GetHealth" {
			health = m
		}
	}
	if health == nil {
		t.Fatalf("no InstanceService.GetHealth row: %s", r.raw)
	}
	if calls := jsonInt(health["calls"]); calls < 3 {
		t.Errorf("calls = %d, want >= 3", calls)
	}
	if errs := jsonInt(health["errors"]); errs < 1 {
		t.Errorf("errors = %d, want >= 1", errs)
	}
	if p95 := jsonInt(health["p95Us"]); p95 <= 0 {
		t.Errorf("p95Us = %d, want > 0", p95)
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

// Background work: the harness starts every loop, so each scheduled job
// carries its interval before its first pass, and the continuous worker
// carries none. The queue counts come back even when nothing is queued.
func TestE2EDiagnosticsJobs(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	ada := h.person("ada")

	h.rpc(ada, diagnostics+"ListJobs", map[string]any{}).expect(t, "permission_denied")
	r := h.rpc(casey, diagnostics+"ListJobs", map[string]any{}).expect(t, "ok")
	jobs := map[string]map[string]any{}
	for _, j := range r.list("jobs") {
		m, _ := j.(map[string]any)
		name, _ := m["name"].(string)
		jobs[name] = m
	}
	for _, name := range []string{"activity_retention", "attachment_retention", "credential_sweep", "delivery_log_sweep", "file_sweep", "message_retention"} {
		j, ok := jobs[name]
		if !ok || j["interval"] == nil || j["interval"] == "" {
			t.Errorf("%s = %v, want an interval", name, j)
		}
	}
	if w, ok := jobs["webhook_worker"]; !ok || w["interval"] != nil || w["nextDue"] != nil {
		t.Errorf("webhook_worker = %v, want no interval and no next_due", w)
	}
	if len(jobs) != 7 {
		t.Errorf("%d jobs, want 7: %s", len(jobs), r.raw)
	}
	if !strings.Contains(r.raw, `"webhooks"`) {
		t.Errorf("no webhooks in %s", r.raw)
	}
}

// GET /metrics is the registry for a bearer token that holds
// instance.read: no token is 401 with the challenge, a token whose holder
// or grant lacks the action is 403, and the admin's reads text with the
// gauges, the procedure counters, the health rows and the build.
func TestE2EDiagnosticsMetrics(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	ada := h.person("ada")
	h.rpc(casey, diagnostics+"GetHealth", map[string]any{}).expect(t, "ok")

	none := h.metrics("").expectStatus(t, http.StatusUnauthorized)
	if none.header.Get("WWW-Authenticate") != "Bearer" {
		t.Errorf("no challenge: %v", none.header)
	}
	h.metrics("not-a-token").expectStatus(t, http.StatusUnauthorized)
	h.metrics(h.pat(ada, "instance.read")).expectStatus(t, http.StatusForbidden)
	h.metrics(h.pat(casey, "messages.read")).expectStatus(t, http.StatusForbidden)

	r := h.metrics(h.pat(casey, "instance.read")).expectStatus(t, http.StatusOK)
	if ct := r.header.Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
		t.Errorf("Content-Type = %q", ct)
	}
	if r.header.Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control = %q", r.header.Get("Cache-Control"))
	}
	for _, want := range []string{
		"# TYPE stoop_connections gauge\nstoop_connections 0\n",
		"stoop_rpc_calls_total{procedure=\"InstanceService.GetHealth\"}",
		"stoop_health{check=\"postgres\"} 0\n",
		"stoop_health{check=\"livekit\"} 3\n",
		"stoop_webhooks_queue_up 1\n",
		"stoop_webhooks_queued 0\n",
		"stoop_build_info{version=",
	} {
		if !strings.Contains(r.raw, want) {
			t.Errorf("no %q in:\n%s", want, r.raw)
		}
	}
}

// metrics reads GET /metrics with a bearer token, or none.
func (h *harness) metrics(token string) reply {
	h.t.Helper()
	r, err := http.NewRequest(http.MethodGet, h.srv.URL+"/metrics", nil)
	if err != nil {
		h.t.Fatal(err)
	}
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	return h.do(r)
}
