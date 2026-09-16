package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/getstoop/stoop/internal/app"
	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

// The end-to-end harness: the whole binary, assembled by its own
// constructor against a throwaway database, served in-process, and driven
// with plain HTTP and JSON, the way curl would. Tests read as "mint an
// identity or a credential, make a request, assert what came back": the
// status, the Connect code, and the sentence a person would read.

type harness struct {
	t   *testing.T
	srv *httptest.Server
}

// newHarness boots the binary; env is extra STOOP_* settings as
// key/value pairs, over the defaults a test needs.
func newHarness(t *testing.T, env ...string) *harness {
	t.Helper()
	t.Setenv("STOOP_DATABASE_URL", dbtest.NewURL(t))
	t.Setenv("STOOP_STORAGE_DIR", t.TempDir())
	t.Setenv("STOOP_REGISTRATION", "open")
	t.Setenv("STOOP_AUTH_RATE_LIMIT", "0")
	t.Setenv("STOOP_ALLOWED_WS_ORIGINS", "*")
	for i := 0; i+1 < len(env); i += 2 {
		t.Setenv(env[i], env[i+1])
	}
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	a, err := app.New(context.Background(), cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(a.Handler())
	// The pipeline behind the handler (sweepers, outgoing deliveries)
	// runs until the test ends, then the pool closes.
	bg, stop := context.WithCancel(context.Background())
	a.StartBackground(bg)
	t.Cleanup(func() {
		stop()
		srv.Close()
		a.Close()
	})
	return &harness{t: t, srv: srv}
}

// reply is what a request came back with.
type reply struct {
	status int
	header http.Header
	body   map[string]any
	raw    string
}

// code is the Connect error code, or "ok".
func (r reply) code() string {
	if c, _ := r.body["code"].(string); c != "" {
		return c
	}
	return "ok"
}

func (r reply) message() string {
	m, _ := r.body["message"].(string)
	return m
}

// str reads a string at a dotted path in the body, "" when absent.
func (r reply) str(path string) string {
	var cur any = r.body
	for _, k := range strings.Split(path, ".") {
		m, ok := cur.(map[string]any)
		if !ok {
			return ""
		}
		cur = m[k]
	}
	s, _ := cur.(string)
	return s
}

// list reads an array at a dotted path in the body.
func (r reply) list(path string) []any {
	var cur any = r.body
	for _, k := range strings.Split(path, ".") {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur = m[k]
	}
	l, _ := cur.([]any)
	return l
}

// rpc calls one Connect procedure ("stoop.chat.v1.ChatService/SendMessage")
// as a bearer token; "" is anonymous.
func (h *harness) rpc(token, procedure string, req any) reply {
	h.t.Helper()
	body, err := json.Marshal(req)
	if err != nil {
		h.t.Fatal(err)
	}
	r, err := http.NewRequest(http.MethodPost, h.srv.URL+"/"+procedure, bytes.NewReader(body))
	if err != nil {
		h.t.Fatal(err)
	}
	r.Header.Set("Content-Type", "application/json")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	return h.do(r)
}

// post sends a raw body to a path, as an appliance would.
func (h *harness) post(path, contentType, body string, headers ...string) reply {
	h.t.Helper()
	url := path
	if strings.HasPrefix(path, "/") {
		url = h.srv.URL + path
	}
	r, err := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		h.t.Fatal(err)
	}
	r.Header.Set("Content-Type", contentType)
	for i := 0; i+1 < len(headers); i += 2 {
		r.Header.Set(headers[i], headers[i+1])
	}
	return h.do(r)
}

func (h *harness) do(r *http.Request) reply {
	h.t.Helper()
	res, err := http.DefaultClient.Do(r)
	if err != nil {
		h.t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	raw, _ := io.ReadAll(res.Body)
	out := reply{status: res.StatusCode, header: res.Header, raw: string(raw)}
	if json.Unmarshal(raw, &out.body) != nil {
		out.body = map[string]any{}
	}
	return out
}

// expect asserts the Connect code and, when given, that the message
// contains a phrase. "ok" means no error.
func (r reply) expect(t *testing.T, code string, contains ...string) reply {
	t.Helper()
	if r.code() != code {
		t.Errorf("want %s, got %s (%d): %s", code, r.code(), r.status, r.raw)
		return r
	}
	for _, c := range contains {
		if !strings.Contains(r.message(), c) {
			t.Errorf("want a message containing %q, got %q", c, r.message())
		}
	}
	return r
}

// expectStatus asserts a plain HTTP status, for the non-Connect surface.
func (r reply) expectStatus(t *testing.T, status int) reply {
	t.Helper()
	if r.status != status {
		t.Errorf("want HTTP %d, got %d: %s", status, r.status, r.raw)
	}
	return r
}

// ---- identities and credentials ----

const password = "correct horse battery"

// person registers an account and signs it in, returning the session
// token. The first person on the instance is its admin.
func (h *harness) person(name string) string {
	h.t.Helper()
	h.rpc("", "stoop.auth.v1.AuthService/Register", map[string]any{"username": name, "password": password}).expect(h.t, "ok")
	login := h.rpc("", "stoop.auth.v1.AuthService/Login", map[string]any{"username": name, "password": password}).expect(h.t, "ok")
	return login.str("token")
}

// userID is the id behind a session or token.
func (h *harness) userID(token string) string {
	h.t.Helper()
	return h.rpc(token, "stoop.auth.v1.AuthService/GetMe", map[string]any{}).expect(h.t, "ok").str("user.id")
}

// space creates a space as the caller and returns its id and the id of
// its default channel.
func (h *harness) space(token, name string) (spaceID, channelID string) {
	h.t.Helper()
	r := h.rpc(token, "stoop.chat.v1.ChatService/CreateSpace", map[string]any{"name": name}).expect(h.t, "ok")
	return r.str("space.id"), r.str("defaultChannel.id")
}

// invite mints an invite code for a space.
func (h *harness) invite(token, spaceID string) string {
	h.t.Helper()
	return h.rpc(token, "stoop.chat.v1.ChatService/CreateInvite", map[string]any{"spaceId": spaceID}).expect(h.t, "ok").str("invite.code")
}

// join redeems an invite as the caller.
func (h *harness) join(token, code string) {
	h.t.Helper()
	h.rpc(token, "stoop.chat.v1.ChatService/JoinSpace", map[string]any{"code": code}).expect(h.t, "ok")
}

// pat mints a personal token for the caller with the named permissions
// ("messages.read", …) and returns its secret.
func (h *harness) pat(session string, permissions ...string) string {
	h.t.Helper()
	return h.rpc(session, "stoop.auth.v1.AuthService/CreatePersonalToken", map[string]any{
		"name": "script", "permissions": perms(permissions), "expiresInDays": 30,
	}).expect(h.t, "ok").str("secret")
}

// bot creates a bot as the admin and returns its user id.
func (h *harness) bot(admin, username string) string {
	h.t.Helper()
	return h.rpc(admin, "stoop.integrations.v1.IntegrationService/CreateBot", map[string]any{
		"username": username, "displayName": strings.Title(username), //nolint:staticcheck // ASCII test names
	}).expect(h.t, "ok").str("bot.id")
}

func (h *harness) addBot(admin, botID, spaceID string) {
	h.t.Helper()
	h.rpc(admin, "stoop.integrations.v1.IntegrationService/AddBotToSpace", map[string]any{"botUserId": botID, "spaceId": spaceID}).expect(h.t, "ok")
}

func (h *harness) removeBot(admin, botID, spaceID string) {
	h.t.Helper()
	h.rpc(admin, "stoop.integrations.v1.IntegrationService/RemoveBotFromSpace", map[string]any{"botUserId": botID, "spaceId": spaceID}).expect(h.t, "ok")
}

// botToken mints a bearer token for a bot and returns its secret.
func (h *harness) botToken(admin, botID string, permissions ...string) string {
	h.t.Helper()
	return h.rpc(admin, "stoop.integrations.v1.IntegrationService/CreateBotToken", map[string]any{
		"botUserId": botID, "name": "probe", "permissions": perms(permissions),
	}).expect(h.t, "ok").str("secret")
}

// hook makes an incoming webhook for a bot in a channel and returns its
// id and the URL an appliance would post to.
func (h *harness) hook(admin, botID, channelID, name string) (id, url string) {
	h.t.Helper()
	r := h.rpc(admin, "stoop.integrations.v1.IntegrationService/CreateIncoming", map[string]any{
		"channelId": channelID, "name": name, "botUserId": botID,
	}).expect(h.t, "ok")
	url = r.str("url")
	if strings.HasPrefix(url, "/") {
		url = h.srv.URL + url
	}
	return r.str("webhook.id"), url
}

// perms turns "messages.read" into the wire's PERMISSION_MESSAGES_READ.
func perms(actions []string) []string {
	out := make([]string, len(actions))
	for i, a := range actions {
		out[i] = "PERMISSION_" + strings.ToUpper(strings.ReplaceAll(a, ".", "_"))
	}
	return out
}

// send posts a message as the caller.
func (h *harness) send(token, channelID, content string) reply {
	h.t.Helper()
	return h.rpc(token, "stoop.chat.v1.ChatService/SendMessage", map[string]any{"channelId": channelID, "content": content})
}

func (h *harness) list(token, channelID string) reply {
	h.t.Helper()
	return h.rpc(token, "stoop.chat.v1.ChatService/ListMessages", map[string]any{"channelId": channelID})
}

// spaceNames is what ListSpaces shows the caller.
func (h *harness) spaceNames(token string) []string {
	h.t.Helper()
	var out []string
	for _, s := range h.rpc(token, "stoop.chat.v1.ChatService/ListSpaces", map[string]any{}).expect(h.t, "ok").list("spaces") {
		if m, ok := s.(map[string]any); ok {
			out = append(out, fmt.Sprint(m["name"]))
		}
	}
	return out
}

// messages is a channel's history as the caller sees it, each message a
// map of its wire fields.
func (h *harness) messages(token, channelID string) []map[string]any {
	h.t.Helper()
	var out []map[string]any
	for _, m := range h.list(token, channelID).expect(h.t, "ok").list("messages") {
		if mm, ok := m.(map[string]any); ok {
			out = append(out, mm)
		}
	}
	return out
}

// message finds the one message in a channel whose content contains a
// phrase, or fails.
func (h *harness) message(token, channelID, contains string) map[string]any {
	h.t.Helper()
	for _, m := range h.messages(token, channelID) {
		if c, _ := m["content"].(string); strings.Contains(c, contains) {
			return m
		}
	}
	h.t.Fatalf("no message containing %q", contains)
	return nil
}
