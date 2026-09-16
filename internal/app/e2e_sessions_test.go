package app_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// A person sees where they are signed in and signs any of it out; only a
// session may, and only their own. The server's session lifetime applies
// to sign-ins from then on. (STOOP-107)
func TestE2ESessions(t *testing.T) {
	h := newHarness(t, "STOOP_SESSION_LIFETIME_DAYS", "2")
	casey := h.person("casey") // the admin
	h.person("ada")
	phone := h.loginFrom(t, "ada", "Phone browser")
	laptop := h.loginFrom(t, "ada", "Laptop browser")

	sessions := h.rpc(laptop, "stoop.auth.v1.AuthService/ListSessions", map[string]any{}).expect(t, "ok").list("sessions")
	if len(sessions) != 3 {
		t.Fatalf("ada has %d sessions, want 3", len(sessions))
	}
	byAgent := map[string]map[string]any{}
	for _, s := range sessions {
		m := s.(map[string]any)
		ua, _ := m["userAgent"].(string)
		byAgent[ua] = m
	}
	if byAgent["Laptop browser"]["current"] != true || byAgent["Phone browser"]["current"] == true {
		t.Errorf("current is not the calling session: %v", sessions)
	}
	if byAgent["Laptop browser"]["lastUsedAt"] == nil {
		t.Error("the calling session has no last use")
	}
	if left := until(t, byAgent["Phone browser"]["expiresAt"]); left < 47*time.Hour || left > 48*time.Hour {
		t.Errorf("a session under STOOP_SESSION_LIFETIME_DAYS=2 lasts %v", left)
	}
	phoneID := byAgent["Phone browser"]["id"].(string)

	// A token sees and ends nothing; nobody ends someone else's session.
	pat := h.pat(laptop, "messages.read")
	h.rpc(pat, "stoop.auth.v1.AuthService/ListSessions", map[string]any{}).expect(t, "permission_denied")
	h.rpc(pat, "stoop.auth.v1.AuthService/RevokeOtherSessions", map[string]any{}).expect(t, "permission_denied")
	h.rpc(casey, "stoop.auth.v1.AuthService/RevokeSession", map[string]any{"sessionId": phoneID}).expect(t, "not_found")
	h.rpc(casey, "stoop.auth.v1.AuthService/RevokeSession", map[string]any{"sessionId": "nope"}).expect(t, "not_found")

	// One session.
	h.rpc(laptop, "stoop.auth.v1.AuthService/RevokeSession", map[string]any{"sessionId": phoneID}).expect(t, "ok")
	h.rpc(phone, "stoop.auth.v1.AuthService/GetMe", map[string]any{}).expect(t, "unauthenticated")
	h.rpc(laptop, "stoop.auth.v1.AuthService/GetMe", map[string]any{}).expect(t, "ok")

	// Everywhere else: the first sign-in goes, this one stays, and a
	// token isn't a session so it stays too.
	got := h.rpc(laptop, "stoop.auth.v1.AuthService/RevokeOtherSessions", map[string]any{}).expect(t, "ok")
	if n, _ := got.body["revoked"].(float64); n != 1 {
		t.Errorf("revoked = %v, want 1", got.body["revoked"])
	}
	if left := h.rpc(laptop, "stoop.auth.v1.AuthService/ListSessions", map[string]any{}).expect(t, "ok").list("sessions"); len(left) != 1 {
		t.Errorf("%d sessions left, want 1", len(left))
	}
	h.rpc(pat, "stoop.chat.v1.ChatService/ListSpaces", map[string]any{}).expect(t, "ok")

	// Ending this session is signing out.
	self := h.rpc(laptop, "stoop.auth.v1.AuthService/ListSessions", map[string]any{}).expect(t, "ok").list("sessions")[0].(map[string]any)["id"]
	out := h.rpc(laptop, "stoop.auth.v1.AuthService/RevokeSession", map[string]any{"sessionId": self}).expect(t, "ok")
	if c := out.header.Get("Set-Cookie"); !strings.Contains(c, "stoop_session=;") {
		t.Errorf("ending the calling session doesn't clear its cookie: %q", c)
	}
	h.rpc(laptop, "stoop.auth.v1.AuthService/GetMe", map[string]any{}).expect(t, "unauthenticated")

	// The lifetime setting: bounded, applied to new sign-ins only, and 0
	// falls back to the environment.
	status := "stoop.instance.v1.InstanceService/GetInstanceStatus"
	settings := "stoop.instance.v1.InstanceService/UpdateSettings"
	h.rpc(casey, settings, map[string]any{"sessionLifetimeDays": 366, "instanceName": "Not saved"}).expect(t, "invalid_argument", "1-365")
	if name := h.rpc("", status, map[string]any{}).expect(t, "ok").str("instanceName"); name == "Not saved" {
		t.Error("a refused lifetime still saved the rest of the form")
	}
	h.rpc(pat, settings, map[string]any{"sessionLifetimeDays": 7}).expect(t, "permission_denied")
	h.rpc(casey, settings, map[string]any{"sessionLifetimeDays": 7}).expect(t, "ok")
	if days, _ := h.rpc("", status, map[string]any{}).expect(t, "ok").body["sessionLifetimeDays"].(float64); days != 7 {
		t.Errorf("status sessionLifetimeDays = %v, want 7", days)
	}
	week := h.loginReply(t, "ada", "Tablet browser")
	if c := week.header.Get("Set-Cookie"); !strings.Contains(c, "Max-Age=604800") {
		t.Errorf("a sign-in under a 7-day lifetime sets cookie %q", c)
	}
	for _, s := range h.rpc(casey, "stoop.auth.v1.AuthService/ListSessions", map[string]any{}).expect(t, "ok").list("sessions") {
		if left := until(t, s.(map[string]any)["expiresAt"]); left > 48*time.Hour {
			t.Errorf("casey's earlier sign-in grew to %v when the lifetime changed", left)
		}
	}
	h.rpc(casey, settings, map[string]any{"sessionLifetimeDays": 0}).expect(t, "ok")
	if days, _ := h.rpc("", status, map[string]any{}).expect(t, "ok").body["sessionLifetimeDays"].(float64); days != 2 {
		t.Errorf("cleared sessionLifetimeDays = %v, want the environment's 2", days)
	}
}

// loginReply signs in with a User-Agent, as a browser would.
func (h *harness) loginReply(t *testing.T, username, userAgent string) reply {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"username": username, "password": password})
	r, err := http.NewRequest(http.MethodPost, h.srv.URL+"/stoop.auth.v1.AuthService/Login", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("User-Agent", userAgent)
	return h.do(r).expect(t, "ok")
}

func (h *harness) loginFrom(t *testing.T, username, userAgent string) string {
	t.Helper()
	return h.loginReply(t, username, userAgent).str("token")
}

// until is how long is left before a JSON timestamp.
func until(t *testing.T, v any) time.Duration {
	t.Helper()
	s, _ := v.(string)
	at, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		t.Fatalf("timestamp %v: %v", v, err)
	}
	return time.Until(at)
}
