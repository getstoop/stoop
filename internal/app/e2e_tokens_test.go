package app_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// A personal token acts as its holder with only what it was granted,
// wherever they are; it can never make more of itself; and the server's
// switch is felt at every use.
func TestE2EPersonalTokenGates(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	ada := h.person("ada")
	_, general := h.space(casey, "The Stoop")
	h.join(ada, h.invite(casey, h.rpc(casey, "stoop.chat.v1.ChatService/ListSpaces", map[string]any{}).expect(t, "ok").list("spaces")[0].(map[string]any)["id"].(string)))

	// What can't be minted.
	h.rpc(ada, "stoop.auth.v1.AuthService/CreatePersonalToken", map[string]any{"name": "x", "permissions": perms([]string{"account.security"})}).expect(t, "invalid_argument", "can't be allowed")
	h.rpc(ada, "stoop.auth.v1.AuthService/CreatePersonalToken", map[string]any{"name": "x", "permissions": perms([]string{"activity.read"})}).expect(t, "invalid_argument", "reading messages and direct messages")
	h.rpc(ada, "stoop.auth.v1.AuthService/CreatePersonalToken", map[string]any{"name": "x", "permissions": perms([]string{"activity.read", "messages.read"})}).expect(t, "invalid_argument")

	// A read-only token reads and nothing else.
	reader := h.pat(ada, "space.read", "messages.read")
	h.list(reader, general).expect(t, "ok")
	h.send(reader, general, "hi").expect(t, "permission_denied", "isn't allowed to post messages")
	h.rpc(reader, "stoop.chat.v1.ChatService/LeaveSpace", map[string]any{"spaceId": h.spaceIDOf(ada, "The Stoop")}).expect(t, "permission_denied")

	// No token makes, lists or revokes tokens, or touches the account.
	h.rpc(reader, "stoop.auth.v1.AuthService/CreatePersonalToken", map[string]any{"name": "child", "permissions": perms([]string{"messages.read"})}).expect(t, "permission_denied", "isn't allowed")
	h.rpc(reader, "stoop.auth.v1.AuthService/ListPersonalTokens", map[string]any{}).expect(t, "permission_denied")
	h.rpc(reader, "stoop.auth.v1.AuthService/ChangePassword", map[string]any{"currentPassword": password, "newPassword": "another horse battery"}).expect(t, "permission_denied")

	// A hook token is never a bearer token, and a bot token never opens
	// the socket; a personal token does.
	bot := h.bot(casey, "uptime")
	h.addBot(casey, bot, h.spaceIDOf(casey, "The Stoop"))
	_, url := h.hook(casey, bot, general, "alerts")
	h.list(url[strings.LastIndex(url, "/")+1:], general).expect(t, "unauthenticated")
	if status := h.socket(h.botToken(casey, bot, "messages.read")); status != http.StatusForbidden {
		t.Errorf("a bot token opened the socket: %d", status)
	}
	if status := h.socket(reader); status != http.StatusSwitchingProtocols {
		t.Errorf("a personal token couldn't open the socket: %d", status)
	}

	// The server's setting is checked at every use, not only at minting.
	h.rpc(casey, "stoop.instance.v1.InstanceService/UpdateSettings", map[string]any{"personalTokens": "PERSONAL_TOKENS_ADMINS"}).expect(t, "ok")
	h.list(reader, general).expect(t, "unauthenticated")
	h.rpc(ada, "stoop.auth.v1.AuthService/CreatePersonalToken", map[string]any{"name": "x", "permissions": perms([]string{"messages.read"})}).expect(t, "permission_denied", "only server admins")
	h.rpc(casey, "stoop.instance.v1.InstanceService/UpdateSettings", map[string]any{"personalTokens": "PERSONAL_TOKENS_EVERYONE"}).expect(t, "ok")
	h.list(reader, general).expect(t, "ok")

	// Revoked is revoked, by the holder or an admin, never by another person.
	tokens := h.rpc(ada, "stoop.auth.v1.AuthService/ListPersonalTokens", map[string]any{}).expect(t, "ok").list("tokens")
	id := tokens[0].(map[string]any)["id"].(string)
	h.rpc(casey, "stoop.auth.v1.AuthService/RevokePersonalToken", map[string]any{"tokenId": id}).expect(t, "not_found")
	h.rpc(casey, "stoop.instance.v1.InstanceService/RevokeUserToken", map[string]any{"userId": h.userID(ada), "tokenId": id}).expect(t, "ok")
	h.list(reader, general).expect(t, "unauthenticated")
}

// spaceIDOf finds a space by name in the caller's list.
func (h *harness) spaceIDOf(token, name string) string {
	h.t.Helper()
	for _, s := range h.rpc(token, "stoop.chat.v1.ChatService/ListSpaces", map[string]any{}).expect(h.t, "ok").list("spaces") {
		if m, ok := s.(map[string]any); ok && m["name"] == name {
			return m["id"].(string)
		}
	}
	h.t.Fatalf("no space named %q", name)
	return ""
}

// socket tries to open /ws as a bearer token and reports the handshake's
// status: 101 when it opened, else the refusal.
func (h *harness) socket(token string) int {
	h.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, res, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(h.srv.URL, "http")+"/ws", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + token}},
	})
	if conn != nil {
		_ = conn.Close(websocket.StatusNormalClosure, "")
	}
	if res == nil {
		h.t.Fatalf("no handshake response: %v", err)
	}
	return res.StatusCode
}
