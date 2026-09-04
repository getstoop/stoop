package voice

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestStaticTURN_InResponse(t *testing.T) {
	opts := configured
	opts.TURN = StaticTURN{
		URLs: []string{"turns:t.example.com:5349"}, Username: "u", Credential: "p",
		STUNURLs: []string{"stun:t.example.com:3478"},
	}
	resp, err := join(newTestService(opts), as("u1"), "voice")
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.IceServers) != 2 || resp.IceServers[0].Urls[0] != "stun:t.example.com:3478" ||
		resp.IceServers[1].Username != "u" || resp.IceServers[1].Credential != "p" {
		t.Errorf("ice servers = %+v", resp.IceServers)
	}
}

func TestJoin_NoTURNMeansNoIceServers(t *testing.T) {
	resp, err := join(newTestService(configured), as("u1"), "voice")
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.IceServers) != 0 {
		t.Errorf("unexpected ice servers: %+v", resp.IceServers)
	}
}

func TestCloudflare_MintsFiltersAndCaches(t *testing.T) {
	calls := 0
	var gotAuth, gotPath string
	var gotTTL int
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		gotAuth, gotPath = r.Header.Get("Authorization"), r.URL.Path
		var body struct {
			TTL int `json:"ttl"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		gotTTL = body.TTL
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"iceServers": []map[string]any{
			{"urls": []string{"stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"}},
			{"urls": []string{"turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"},
				"username": "cf-user", "credential": "cf-pass"},
		}})
	}))
	defer api.Close()

	src := newCloudflareSource(CloudflareTURN{KeyID: "key123", APIToken: "tok", BaseURL: api.URL})
	now := time.Unix(1_700_000_000, 0)
	src.now = func() time.Time { return now }

	servers, err := src.ICEServers(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if gotAuth != "Bearer tok" || gotPath != "/v1/turn/keys/key123/credentials/generate-ice-servers" || gotTTL != 86400 {
		t.Errorf("request: auth=%q path=%q ttl=%d", gotAuth, gotPath, gotTTL)
	}
	if len(servers) != 2 || len(servers[0].Urls) != 1 || len(servers[1].Urls) != 2 ||
		servers[1].Username != "cf-user" || servers[1].Credential != "cf-pass" {
		t.Errorf("servers = %+v (port-53 entries must be dropped)", servers)
	}

	// Within the TTL the same batch is reused; near expiry a new one is minted.
	now = now.Add(10 * time.Hour)
	if _, err := src.ICEServers(context.Background()); err != nil || calls != 1 {
		t.Errorf("expected cached credentials, calls = %d, err = %v", calls, err)
	}
	now = now.Add(11 * time.Hour) // 21h in: less than 4h left
	if _, err := src.ICEServers(context.Background()); err != nil || calls != 2 {
		t.Errorf("expected a refresh, calls = %d, err = %v", calls, err)
	}
}

func TestCloudflare_FailureDoesNotBlockJoin(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":"nope"}`, http.StatusUnauthorized)
	}))
	defer api.Close()
	opts := configured
	opts.Cloudflare = CloudflareTURN{KeyID: "k", APIToken: "bad", BaseURL: api.URL}
	resp, err := join(newTestService(opts), as("u1"), "voice")
	if err != nil {
		t.Fatalf("join must succeed without TURN: %v", err)
	}
	if len(resp.IceServers) != 0 || resp.LivekitToken == "" {
		t.Errorf("resp = %+v", resp)
	}
}

type fakeRelay struct {
	settings RelaySettings
	err      error
}

func (f *fakeRelay) RelaySettings(context.Context) (RelaySettings, error) { return f.settings, f.err }

func TestRelayProvider_OverridesOptionsAndKeepsCloudflareSource(t *testing.T) {
	calls := 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"iceServers": []map[string]any{
			{"urls": []string{"stun:stun.cloudflare.com:3478"}},
			{"urls": []string{"turns:turn.cloudflare.com:443?transport=tcp"}, "username": "u", "credential": "c"},
		}})
	}))
	defer api.Close()

	opts := configured
	opts.TURN = StaticTURN{URLs: []string{"turns:from-options.example.com:5349"}, Username: "o", Credential: "o"}
	s := newTestService(opts)
	relay := &fakeRelay{settings: RelaySettings{
		TURN:       StaticTURN{STUNURLs: []string{"stun:relay.example.com:3478"}},
		Cloudflare: CloudflareTURN{KeyID: "k1", APIToken: "t1", BaseURL: api.URL},
	}}
	s.UseRelayProvider(relay)

	resp, err := join(s, as("u1"), "voice")
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.IceServers) != 3 || resp.IceServers[0].Urls[0] != "stun:relay.example.com:3478" || resp.IceServers[2].Username != "u" {
		t.Errorf("provider settings not used: %+v", resp.IceServers)
	}
	for _, s := range resp.IceServers {
		if len(s.Urls) > 0 && s.Urls[0] == "turns:from-options.example.com:5349" {
			t.Error("Options' TURN must not apply once a provider is set")
		}
	}
	// Same key → cached credentials; changed key → fresh source.
	if _, err := join(s, as("u1"), "voice"); err != nil || calls != 1 {
		t.Errorf("second join should reuse minted credentials, calls = %d", calls)
	}
	relay.settings.Cloudflare.KeyID = "k2"
	if _, err := join(s, as("u1"), "voice"); err != nil || calls != 2 {
		t.Errorf("changed key should mint again, calls = %d", calls)
	}
	// Provider failure: join still succeeds, without relays.
	relay.err = errors.New("db down")
	resp, err = join(s, as("u1"), "voice")
	if err != nil || len(resp.IceServers) != 0 {
		t.Errorf("provider failure must not block the join: %v %+v", err, resp)
	}
}
