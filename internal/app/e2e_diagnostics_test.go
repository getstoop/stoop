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

	// The panels that are not built yet say so, but only to an admin.
	for _, proc := range []string{"GetLiveStats", "GetDatabaseStats", "GetRequestStats"} {
		h.rpc(ada, diagnostics+proc, map[string]any{}).expect(t, "permission_denied")
		h.rpc(casey, diagnostics+proc, map[string]any{}).expect(t, "unimplemented")
	}
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
