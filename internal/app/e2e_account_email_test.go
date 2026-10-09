package app_test

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

const accountAuth = "stoop.auth.v1.AuthService/"

// emailHarness is a server with email switched on and a pool onto its
// database for what only the database shows.
func emailHarness(t *testing.T) (*harness, *pgxpool.Pool, string) {
	t.Helper()
	databaseURL := dbtest.NewURL(t)
	instance := newHarnessOn(t, databaseURL, "STOOP_PUBLIC_URL", "https://chat.example.com")
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	casey := instance.person("casey")
	instance.rpc(casey, email+"UpdateEmailSettings", map[string]any{"smtp": map[string]any{
		"enabled": true, "host": "smtp.example.net", "security": "SMTP_SECURITY_STARTTLS",
		"fromAddress": "stoop@example.net", "hourlyLimit": 100,
	}}).expect(t, "ok")
	return instance, pool, casey
}

// storeConfirmLink stores a link for the address the way the send_email job
// does and returns the token it would carry.
func storeConfirmLink(t *testing.T, pool *pgxpool.Pool, userID, address string) string {
	t.Helper()
	token := uuid.NewString()
	sum := sha256.Sum256([]byte(token))
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO email_tokens (id, user_id, purpose, token_hash, address, expires_at) VALUES ($1, $2, 'confirm_email', $3, $4, $5)`,
		uuid.NewString(), userID, sum[:], address, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	return token
}

// sendEmailArgs is the arguments of every send_email job for a user,
// oldest first.
func sendEmailArgs(t *testing.T, pool *pgxpool.Pool, userID string) []map[string]any {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT args FROM jobs WHERE kind = 'send_email' AND args->>'user_id' = $1 ORDER BY created_at`, userID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var args map[string]any
		if err := json.Unmarshal(raw, &args); err != nil {
			t.Fatal(err)
		}
		out = append(out, args)
	}
	return out
}

// An address is asked for, confirmed from its link, and then seen by the
// person and the admins only.
func TestE2EAccountEmail(t *testing.T) {
	instance, pool, casey := emailHarness(t)
	ada := instance.person("ada")
	bea := instance.person("bea")
	adaID := instance.userID(ada)
	spaceID, _ := instance.space(casey, "Porch")
	instance.join(ada, instance.invite(casey, spaceID))
	instance.join(bea, instance.invite(casey, spaceID))

	instance.rpc(ada, accountAuth+"RequestEmailChange", map[string]any{"address": "ada@example.com", "password": "not it"}).
		expect(t, "invalid_argument", "incorrect")
	asked := instance.rpc(ada, accountAuth+"RequestEmailChange", map[string]any{"address": "ada@example.com", "password": password}).expect(t, "ok")
	if asked.str("email.pendingAddress") != "ada@example.com" {
		t.Errorf("request: %s", asked.raw)
	}
	want := []map[string]any{{"template": "confirm_email", "user_id": adaID}}
	if got := sendEmailArgs(t, pool, adaID); !reflect.DeepEqual(got, want) {
		t.Errorf("send_email args = %v, want %v", got, want)
	}

	instance.rpc("", accountAuth+"ConfirmEmail", map[string]any{"token": "not a link"}).expect(t, "failed_precondition", "expired or was already used")
	token := storeConfirmLink(t, pool, adaID, "ada@example.com")
	instance.rpc("", accountAuth+"ConfirmEmail", map[string]any{"token": token}).expect(t, "ok")
	instance.rpc("", accountAuth+"ConfirmEmail", map[string]any{"token": token}).expect(t, "failed_precondition", "expired or was already used")

	me := instance.rpc(ada, accountAuth+"GetMe", map[string]any{}).expect(t, "ok")
	if me.str("email.address") != "ada@example.com" || me.str("email.pendingAddress") != "" {
		t.Errorf("GetMe: %s", me.raw)
	}
	if user, _ := json.Marshal(me.body["user"]); strings.Contains(string(user), "ada@example.com") {
		t.Errorf("the address is on User: %s", user)
	}

	found := false
	for _, entry := range instance.rpc(casey, email+"ListUsers", map[string]any{}).expect(t, "ok").list("users") {
		if user, _ := entry.(map[string]any); user["id"] == adaID {
			found = user["email"] == "ada@example.com"
		}
	}
	if !found {
		t.Error("the admin list doesn't show ada's address")
	}

	for name, answer := range map[string]reply{
		"profile": instance.rpc(bea, accountAuth+"GetUserProfile", map[string]any{"userId": adaID}).expect(t, "ok"),
		"members": instance.rpc(bea, "stoop.chat.v1.ChatService/ListMembers", map[string]any{"spaceId": spaceID}).expect(t, "ok"),
	} {
		if strings.Contains(answer.raw, "ada@example.com") {
			t.Errorf("a member's %s shows the address: %s", name, answer.raw)
		}
	}
}

// Three emails an hour per account, the request and resends together.
func TestE2EAccountEmailLimit(t *testing.T) {
	instance, _, _ := emailHarness(t)
	ada := instance.person("ada")
	instance.rpc(ada, accountAuth+"ResendEmailConfirmation", map[string]any{}).expect(t, "failed_precondition", "no address waiting")
	instance.rpc(ada, accountAuth+"RequestEmailChange", map[string]any{"address": "ada@example.com", "password": password}).expect(t, "ok")
	instance.rpc(ada, accountAuth+"ResendEmailConfirmation", map[string]any{}).expect(t, "ok")
	instance.rpc(ada, accountAuth+"ResendEmailConfirmation", map[string]any{}).expect(t, "ok")
	refused := instance.rpc(ada, accountAuth+"ResendEmailConfirmation", map[string]any{}).expect(t, "resource_exhausted")
	if refused.header.Get("Retry-After") == "" {
		t.Errorf("no Retry-After: %v", refused.header)
	}
	instance.rpc(ada, accountAuth+"RequestEmailChange", map[string]any{"address": "ada@example.net", "password": password}).expect(t, "resource_exhausted")
}

func TestE2EAccountEmailOff(t *testing.T) {
	instance := newHarness(t)
	casey := instance.person("casey")
	instance.rpc(casey, accountAuth+"RequestEmailChange", map[string]any{"address": "casey@example.com", "password": password}).
		expect(t, "failed_precondition", "doesn't send email")
}

// No public URL, no link to send: the request is refused instead of
// leaving an address waiting for a link that never comes.
func TestE2EAccountEmailNeedsPublicURL(t *testing.T) {
	instance := newHarnessOn(t, dbtest.NewURL(t))
	casey := instance.person("casey")
	instance.rpc(casey, email+"UpdateEmailSettings", map[string]any{"smtp": map[string]any{
		"enabled": true, "host": "smtp.example.net", "security": "SMTP_SECURITY_STARTTLS",
		"fromAddress": "stoop@example.net", "hourlyLimit": 100,
	}}).expect(t, "ok")
	instance.rpc(casey, accountAuth+"RequestEmailChange", map[string]any{"address": "casey@example.com", "password": password}).
		expect(t, "failed_precondition", "can't send links yet")
}

// Asking again for the address already waiting keeps the link already
// delivered: only the new send, once out, retires it.
func TestE2EAccountEmailSameAddressKeepsLink(t *testing.T) {
	instance, pool, _ := emailHarness(t)
	ada := instance.person("ada")
	adaID := instance.userID(ada)
	instance.rpc(ada, accountAuth+"RequestEmailChange", map[string]any{"address": "ada@example.com", "password": password}).expect(t, "ok")
	token := storeConfirmLink(t, pool, adaID, "ada@example.com")
	instance.rpc(ada, accountAuth+"RequestEmailChange", map[string]any{"address": "ADA@example.com", "password": password}).expect(t, "ok")
	instance.rpc("", accountAuth+"ConfirmEmail", map[string]any{"token": token}).expect(t, "ok")
}
