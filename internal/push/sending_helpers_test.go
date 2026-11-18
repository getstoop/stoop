package push

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	pushv1 "github.com/getstoop/stoop/gen/stoop/push/v1"
)

// The sending rig: a fake relay standing in for the push service, and
// fakes for every port. The relay is a local TLS server; the service's
// client is swapped for one that trusts it, which only a test in this
// package can do, since production posts through netguard's public-only
// transport.

type fakeAccounts struct {
	mu      sync.Mutex
	dnd     bool
	expired map[string]bool
}

func (f *fakeAccounts) DoNotDisturb(context.Context, string) (bool, *time.Time, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.dnd, nil, nil
}

func (f *fakeAccounts) LiveSessions(_ context.Context, ids []string) ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var live []string
	for _, id := range ids {
		if !f.expired[id] {
			live = append(live, id)
		}
	}
	return live, nil
}

type fakeSockets struct{ connected map[string]bool }

func (f fakeSockets) SessionConnected(sessionID string) bool { return f.connected[sessionID] }

type fakeChat struct {
	space, channel string
	waiting        int
	err            error
}

func (f fakeChat) PlaceNames(context.Context, string) (string, string, error) {
	return f.space, f.channel, f.err
}

func (f fakeChat) WaitingTotal(context.Context, string) (int, error) { return f.waiting, nil }

type fakeJobs struct {
	mu     sync.Mutex
	queued []DeliveryArgs
}

func (f *fakeJobs) Enqueue(_ context.Context, kind string, args any) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if kind == DeliverPushKind {
		f.queued = append(f.queued, args.(DeliveryArgs))
	}
	return "job", nil
}

func (f *fakeJobs) taken() []DeliveryArgs {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.queued)
}

type offPolicy struct{}

func (offPolicy) PushEnabled(context.Context) (bool, error) { return false, nil }

// relay is the fake push service: it answers with status (and
// retryAfter, when set) and keeps every request.
type relay struct {
	server *httptest.Server

	mu         sync.Mutex
	status     int
	retryAfter string
	requests   []relayed
}

type relayed struct {
	header http.Header
	path   string
	body   []byte
}

func newRelay(t *testing.T) *relay {
	t.Helper()
	fake := &relay{status: http.StatusCreated}
	fake.server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		body, _ := io.ReadAll(req.Body)
		fake.mu.Lock()
		defer fake.mu.Unlock()
		fake.requests = append(fake.requests, relayed{header: req.Header.Clone(), path: req.URL.Path, body: body})
		if fake.retryAfter != "" {
			w.Header().Set("Retry-After", fake.retryAfter)
		}
		w.WriteHeader(fake.status)
	}))
	t.Cleanup(fake.server.Close)
	return fake
}

func (fake *relay) answer(status int, retryAfter string) {
	fake.mu.Lock()
	defer fake.mu.Unlock()
	fake.status, fake.retryAfter = status, retryAfter
}

func (fake *relay) received() []relayed {
	fake.mu.Lock()
	defer fake.mu.Unlock()
	return slices.Clone(fake.requests)
}

// rig is a service wired to fakes and a relay, with ada signed in on one
// device registered for mentions and direct messages.
type rig struct {
	*fixture
	relay     *relay
	accounts  *fakeAccounts
	sockets   fakeSockets
	jobs      *fakeJobs
	sessionID string
	device    *ecdh.PrivateKey
	auth      []byte
	subID     string
}

func newRig(t *testing.T) *rig {
	t.Helper()
	fix := setup(t)
	bench := &rig{
		fixture: fix, relay: newRelay(t), accounts: &fakeAccounts{expired: map[string]bool{}},
		sockets: fakeSockets{connected: map[string]bool{}}, jobs: &fakeJobs{},
	}
	fix.svc.client = bench.relay.server.Client()
	fix.svc.UseSending(nil, bench.accounts, fakeChat{space: "The Stoop", channel: "general", waiting: 3}, bench.jobs, nil)
	fix.svc.UseSockets(bench.sockets)
	ctx, session := fix.session(t)
	bench.sessionID = session
	device, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	bench.device = device
	bench.auth = make([]byte, 16)
	_, _ = rand.Read(bench.auth)
	if _, err := fix.svc.RegisterPushSubscription(ctx, connect.NewRequest(&pushv1.RegisterPushSubscriptionRequest{
		Endpoint: bench.relay.server.URL + "/push/device-1", P256Dh: device.PublicKey().Bytes(), Auth: bench.auth,
		LocalServerId: "k3x9pq",
		Kinds:         []chatv1.ActivityKind{chatv1.ActivityKind_ACTIVITY_KIND_MENTION, chatv1.ActivityKind_ACTIVITY_KIND_DM},
	})); err != nil {
		t.Fatal(err)
	}
	if err := fix.pool.QueryRow(context.Background(),
		`SELECT id FROM push_subscriptions WHERE credential_id = $1`, session).Scan(&bench.subID); err != nil {
		t.Fatal(err)
	}
	return bench
}

// mention is an unread, unmuted mention of ada.
func mention() *chatv1.ActivityItem {
	return &chatv1.ActivityItem{
		Id: "0193a5b2-0000-7000-8000-000000000001", Kind: chatv1.ActivityKind_ACTIVITY_KIND_MENTION,
		SpaceId: "0193a5b2-0000-7000-8000-0000000000a1", ChannelId: "0193a5b2-0000-7000-8000-0000000000c1",
		MessageId: "0193a5b2-0000-7000-8000-0000000000e1",
		Actor:     &chatv1.MessageAuthor{Username: "bea", DisplayName: "Bea Marsh"},
		Preview:   "@ada can you look at the build?",
	}
}

// record reads the subscription's delivery record; ok is false when
// the row is gone.
func (bench *rig) record(t *testing.T) (failures int32, lastFailure string, succeeded, ok bool) {
	t.Helper()
	var successAt *time.Time
	err := bench.pool.QueryRow(context.Background(),
		`SELECT failures, last_failure, last_success_at FROM push_subscriptions WHERE id = $1`, bench.subID,
	).Scan(&failures, &lastFailure, &successAt)
	if err != nil {
		return 0, "", false, false
	}
	return failures, lastFailure, successAt != nil, true
}

// decryptBody opens an aes128gcm body with the device's private key
// (RFC 8291 §3.4, RFC 8188 §2) and strips the padding.
func decryptBody(t *testing.T, device *ecdh.PrivateKey, auth, body []byte) []byte {
	t.Helper()
	if len(body) < 21 {
		t.Fatalf("body of %d bytes has no header", len(body))
	}
	salt, idLen := body[:16], int(body[20])
	if binary.BigEndian.Uint32(body[16:20]) != 4096 {
		t.Errorf("record size = %d", binary.BigEndian.Uint32(body[16:20]))
	}
	keyID, sealed := body[21:21+idLen], body[21+idLen:]
	sender, err := ecdh.P256().NewPublicKey(keyID)
	if err != nil {
		t.Fatalf("sender key: %v", err)
	}
	shared, err := device.ECDH(sender)
	if err != nil {
		t.Fatal(err)
	}
	info := "WebPush: info\x00" + string(device.PublicKey().Bytes()) + string(keyID)
	ikm, err := hkdf.Key(sha256.New, shared, auth, info, 32)
	if err != nil {
		t.Fatal(err)
	}
	prk, err := hkdf.Extract(sha256.New, ikm, salt)
	if err != nil {
		t.Fatal(err)
	}
	key, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	record, err := aead.Open(nil, nonce, sealed, nil)
	if err != nil {
		t.Fatalf("the body does not open with the device's key: %v", err)
	}
	trimmed := bytes.TrimRight(record, "\x00")
	if len(trimmed) == 0 || trimmed[len(trimmed)-1] != 0x02 {
		t.Fatal("record does not end in the last-record delimiter")
	}
	return trimmed[:len(trimmed)-1]
}
