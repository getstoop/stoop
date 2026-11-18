package app_test

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

// A device registers for push with its session, a token can't, and the
// subscription goes when the session does: signing out, signing out
// everywhere, or the account being deactivated.
func TestE2EPushSubscriptions(t *testing.T) {
	url := dbtest.NewURL(t)
	server := newHarnessOn(t, url)
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	count := func() int {
		t.Helper()
		var rows int
		if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM push_subscriptions`).Scan(&rows); err != nil {
			t.Fatal(err)
		}
		return rows
	}

	const (
		config   = "stoop.push.v1.PushService/GetPushConfig"
		register = "stoop.push.v1.PushService/RegisterPushSubscription"
		update   = "stoop.push.v1.PushService/UpdatePushSubscription"
		remove   = "stoop.push.v1.PushService/DeletePushSubscription"
	)
	casey := server.person("casey") // the admin
	server.person("ada")
	phone := server.loginFrom(t, "ada", "Phone")
	tablet := server.loginFrom(t, "ada", "Tablet")

	got := server.rpc(phone, config, map[string]any{}).expect(t, "ok")
	key, err := base64.StdEncoding.DecodeString(got.str("applicationServerKey"))
	if err != nil || len(key) != 65 || got.body["enabled"] != true {
		t.Fatalf("GetPushConfig = %v", got.body)
	}
	if again := server.rpc(tablet, config, map[string]any{}).expect(t, "ok").str("applicationServerKey"); again != got.str("applicationServerKey") {
		t.Error("the signing key changed between calls")
	}

	subscription := func() map[string]any {
		device, err := ecdh.P256().GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		return map[string]any{
			"endpoint":      "https://relay.example/push/abc",
			"p256dh":        base64.StdEncoding.EncodeToString(device.PublicKey().Bytes()),
			"auth":          base64.StdEncoding.EncodeToString(make([]byte, 16)),
			"localServerId": "k3x9pq",
			"kinds":         []string{"ACTIVITY_KIND_MENTION", "ACTIVITY_KIND_DM"},
		}
	}

	pat := server.pat(phone, "preferences.manage")
	for _, procedure := range []string{config, register, update, remove} {
		server.rpc(pat, procedure, subscription()).expect(t, "permission_denied")
	}
	bad := subscription()
	bad["endpoint"] = "http://relay.example/push"
	if field := server.rpc(phone, register, bad).expect(t, "invalid_argument", "https").field(); field != "endpoint" {
		t.Errorf("field = %q, want endpoint", field)
	}

	server.rpc(phone, register, subscription()).expect(t, "ok")
	server.rpc(phone, register, subscription()).expect(t, "ok")
	server.rpc(tablet, register, subscription()).expect(t, "ok")
	if n := count(); n != 2 {
		t.Fatalf("%d subscriptions for two sessions, want 2", n)
	}
	server.rpc(phone, update, map[string]any{"kinds": []string{"ACTIVITY_KIND_REPLY"}}).expect(t, "ok")
	server.rpc(phone, remove, map[string]any{}).expect(t, "ok")
	server.rpc(phone, remove, map[string]any{}).expect(t, "ok")
	server.rpc(phone, update, map[string]any{}).expect(t, "not_found", "isn't registered")

	// Signing out takes the session's subscription with it.
	server.rpc(phone, register, subscription()).expect(t, "ok")
	server.rpc(phone, "stoop.auth.v1.AuthService/Logout", map[string]any{}).expect(t, "ok")
	if n := count(); n != 1 {
		t.Errorf("%d subscriptions after the phone signed out, want 1", n)
	}
	server.rpc(tablet, "stoop.auth.v1.AuthService/SignOutEverywhere", map[string]any{}).expect(t, "ok")
	if n := count(); n != 0 {
		t.Errorf("%d subscriptions after signing out everywhere, want 0", n)
	}

	// Deactivating the account revokes its sessions, and so its
	// subscriptions.
	phone = server.loginFrom(t, "ada", "Phone")
	server.rpc(phone, register, subscription()).expect(t, "ok")
	server.rpc(casey, "stoop.instance.v1.InstanceService/SetUserActive", map[string]any{
		"userId": server.userID(phone), "active": false,
	}).expect(t, "ok")
	if n := count(); n != 0 {
		t.Errorf("%d subscriptions after deactivation, want 0", n)
	}
}

// A mention of someone with a registered device and no socket open is
// heard and queued as one delivery, for that device; one they made
// themselves is not. The endpoint is not reachable from here, so this
// stops at the queue (internal/push sends to a fake relay).
func TestE2EPushQueuesADelivery(t *testing.T) {
	url := dbtest.NewURL(t)
	server := newHarnessOn(t, url)
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	queued := func() int {
		t.Helper()
		var rows int
		if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM jobs WHERE kind = 'deliver_push'`).Scan(&rows); err != nil {
			t.Fatal(err)
		}
		return rows
	}

	casey := server.person("casey")
	server.person("ada")
	phone := server.loginFrom(t, "ada", "Phone")
	spaceID, channelID := server.space(casey, "Porch")
	server.join(phone, server.invite(casey, spaceID))
	device, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	server.rpc(phone, "stoop.push.v1.PushService/RegisterPushSubscription", map[string]any{
		"endpoint":      "https://relay.example/push/abc",
		"p256dh":        base64.StdEncoding.EncodeToString(device.PublicKey().Bytes()),
		"auth":          base64.StdEncoding.EncodeToString(make([]byte, 16)),
		"localServerId": "k3x9pq",
		"kinds":         []string{"ACTIVITY_KIND_MENTION"},
	}).expect(t, "ok")

	server.send(phone, channelID, server.mention(phone)+" a note to self").expect(t, "ok")
	server.send(casey, channelID, server.mention(phone)+" look at this").expect(t, "ok")
	deadline := time.Now().Add(5 * time.Second)
	for queued() == 0 && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if n := queued(); n != 1 {
		t.Errorf("%d deliveries queued, want 1", n)
	}
}
