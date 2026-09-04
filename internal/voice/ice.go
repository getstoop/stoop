package voice

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	voicev1 "github.com/Jhut89/stoop/gen/stoop/voice/v1"
)

// ICE servers are how voice survives front doors that only carry HTTP
// (Cloudflare Tunnel, Tailscale Funnel) and networks where LiveKit's media
// ports can't be reached: the browser relays through TURN instead. The
// browser uses these instead of LiveKit's own list, so a source must
// include STUN as well as TURN.

// iceSource yields the servers to hand a joining browser.
type iceSource interface {
	ICEServers(ctx context.Context) ([]*voicev1.IceServer, error)
}

// StaticTURN is a TURN server with long-lived credentials (coturn, or a
// hosted service that issues them).
type StaticTURN struct {
	URLs       []string
	Username   string
	Credential string
	// STUNURLs are offered alongside. coturn answers STUN on the same
	// port, so "stun:<host>:3478" is the usual value.
	STUNURLs []string
}

func (s StaticTURN) ICEServers(context.Context) ([]*voicev1.IceServer, error) {
	var out []*voicev1.IceServer
	if len(s.STUNURLs) > 0 {
		out = append(out, &voicev1.IceServer{Urls: s.STUNURLs})
	}
	if len(s.URLs) > 0 {
		out = append(out, &voicev1.IceServer{Urls: s.URLs, Username: s.Username, Credential: s.Credential})
	}
	return out, nil
}

// CloudflareTURN mints credentials for Cloudflare's TURN service. They're
// short-lived by design, so Stoop generates them itself rather than
// asking the operator to paste a password that expires.
type CloudflareTURN struct {
	KeyID    string
	APIToken string
	// BaseURL overrides the API host (tests). Empty means Cloudflare's.
	BaseURL string
}

const (
	cloudflareBaseURL = "https://rtc.live.cloudflare.com"
	// cloudflareTTL is what we ask for; the API allows up to 48 h. One
	// batch of credentials is shared by every join until it nears expiry.
	cloudflareTTL = 24 * time.Hour
	// cloudflareRefreshBefore leaves enough of the TTL for a call that
	// starts on the last credentials issued.
	cloudflareRefreshBefore = 4 * time.Hour
)

type cloudflareSource struct {
	cfg    CloudflareTURN // as given (compared to detect changes)
	api    string         // base URL, defaulted
	client *http.Client
	now    func() time.Time

	mu      sync.Mutex
	cached  []*voicev1.IceServer
	expires time.Time
}

func newCloudflareSource(cfg CloudflareTURN) *cloudflareSource {
	api := cfg.BaseURL
	if api == "" {
		api = cloudflareBaseURL
	}
	return &cloudflareSource{cfg: cfg, api: api, client: &http.Client{Timeout: 10 * time.Second}, now: time.Now}
}

func (c *cloudflareSource) ICEServers(ctx context.Context) ([]*voicev1.IceServer, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cached != nil && c.now().Before(c.expires.Add(-cloudflareRefreshBefore)) {
		return c.cached, nil
	}
	servers, err := c.generate(ctx)
	if err != nil {
		if c.cached != nil && c.now().Before(c.expires) {
			// Still valid; serve the old batch and try again next join.
			return c.cached, nil
		}
		return nil, err
	}
	c.cached = servers
	c.expires = c.now().Add(cloudflareTTL)
	return servers, nil
}

// generate calls Cloudflare's credentials API:
// https://developers.cloudflare.com/realtime/turn/generate-credentials/
func (c *cloudflareSource) generate(ctx context.Context) ([]*voicev1.IceServer, error) {
	body, _ := json.Marshal(map[string]int{"ttl": int(cloudflareTTL / time.Second)})
	url := fmt.Sprintf("%s/v1/turn/keys/%s/credentials/generate-ice-servers", c.api, c.cfg.KeyID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.cfg.APIToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("cloudflare turn: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("cloudflare turn: %s: %s", resp.Status, strings.TrimSpace(string(msg)))
	}
	var parsed struct {
		IceServers []struct {
			URLs       []string `json:"urls"`
			Username   string   `json:"username"`
			Credential string   `json:"credential"`
		} `json:"iceServers"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("cloudflare turn: parse response: %w", err)
	}
	var out []*voicev1.IceServer
	for _, s := range parsed.IceServers {
		var urls []string
		for _, u := range s.URLs {
			// Cloudflare also lists port 53, which browsers refuse; keeping
			// it only adds ICE timeouts.
			if strings.Contains(u, ":53?") || strings.HasSuffix(u, ":53") {
				continue
			}
			urls = append(urls, u)
		}
		if len(urls) > 0 {
			out = append(out, &voicev1.IceServer{Urls: urls, Username: s.Username, Credential: s.Credential})
		}
	}
	if len(out) == 0 {
		return nil, errors.New("cloudflare turn: response listed no usable servers")
	}
	return out, nil
}

// RelaySettings is the relay configuration in force for a join.
type RelaySettings struct {
	TURN       StaticTURN
	Cloudflare CloudflareTURN
}

// RelayProvider is voice's port for runtime relay settings (the admin page
// can change them); implemented by the instance module, wired in
// internal/app. Without one, Options' values apply.
type RelayProvider interface {
	RelaySettings(ctx context.Context) (RelaySettings, error)
}

// UseRelayProvider switches from Options' fixed relay settings to ones
// looked up per join.
func (s *Service) UseRelayProvider(p RelayProvider) { s.relay = p }

// sources returns the ICE sources for this join. Cloudflare's source is
// kept across joins (it caches minted credentials) and replaced only when
// the key changes.
func (s *Service) sources(ctx context.Context) ([]iceSource, error) {
	if s.relay == nil {
		return s.ice, nil
	}
	rs, err := s.relay.RelaySettings(ctx)
	if err != nil {
		return nil, err
	}
	var out []iceSource
	if len(rs.TURN.URLs) > 0 || len(rs.TURN.STUNURLs) > 0 {
		out = append(out, rs.TURN)
	}
	if rs.Cloudflare.KeyID != "" {
		s.cfMu.Lock()
		if s.cf == nil || s.cf.cfg != rs.Cloudflare {
			s.cf = newCloudflareSource(rs.Cloudflare)
		}
		cf := s.cf
		s.cfMu.Unlock()
		out = append(out, cf)
	}
	return out, nil
}

// iceServers gathers every configured source. A failing source is logged
// and skipped: a join without TURN can still work on a direct path, and
// refusing it would turn a relay outage into a voice outage.
func (s *Service) iceServers(ctx context.Context) []*voicev1.IceServer {
	srcs, err := s.sources(ctx)
	if err != nil {
		s.log.Warn("voice: relay settings unavailable", "err", err)
		return nil
	}
	var out []*voicev1.IceServer
	for _, src := range srcs {
		servers, err := src.ICEServers(ctx)
		if err != nil {
			s.log.Warn("voice: ICE servers unavailable", "err", err)
			continue
		}
		out = append(out, servers...)
	}
	return out
}
