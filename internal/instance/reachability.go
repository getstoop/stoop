package instance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	instancev1 "github.com/Jhut89/stoop/gen/stoop/instance/v1"
	"github.com/Jhut89/stoop/internal/dbgen"
	"github.com/Jhut89/stoop/internal/trustedproxy"
)

// Reachability — how people reach this server — is configured either from
// the environment (docker-compose users editing .env) or from the setup
// wizard / admin page. A saved value wins over the environment; clearing
// it falls back. Nothing here is seeded: the environment stays live as
// the fallback, so editing .env keeps working for people who never touch
// the UI.

const (
	keyPublicURL      = "public_url"
	keyTURN           = "turn"
	keyCloudflareTURN = "cloudflare_turn"
	keyTailscale      = "tailscale"
	keyTrustedProxies = "trusted_proxies"
	// keyLiveKit holds the API key pair Stoop signs room tokens with. It
	// is minted on first boot when the environment supplies none, so
	// nobody has to copy a secret between two files by hand.
	keyLiveKit = "livekit"
)

// maxTrustedProxies bounds the saved list; a homelab has one or two.
const maxTrustedProxies = 32

// TURNRelay is a relay with fixed credentials.
type TURNRelay struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username"`
	Credential string   `json:"credential"`
	STUNURLs   []string `json:"stun_urls"`
}

// CloudflareTURN is Cloudflare's TURN service.
type CloudflareTURN struct {
	KeyID    string `json:"key_id"`
	APIToken string `json:"api_token"`
}

// TailscaleSettings control the built-in Tailscale listener.
type TailscaleSettings struct {
	Enabled    bool   `json:"enabled"`
	Hostname   string `json:"hostname"`
	Funnel     bool   `json:"funnel"`
	AuthKey    string `json:"auth_key"`
	ControlURL string `json:"control_url"`
}

// Reachability is the effective set.
type Reachability struct {
	PublicURL  string
	TURN       TURNRelay
	Cloudflare CloudflareTURN
	Tailscale  TailscaleSettings
	// TrustedProxies is deliberately not tied to any of the above: an
	// internal proxy can sit in front of a tunnel, a tailnet, or nothing.
	TrustedProxies trustedproxy.Set
}

// LiveKitCredentials is a LiveKit API key pair as this module stores it.
// The voice module has its own type; internal/app translates, because
// modules don't import each other.
type LiveKitCredentials struct {
	APIKey    string `json:"api_key"`
	APISecret string `json:"api_secret"`
}

// LiveKitKeys returns the saved LiveKit credentials, if any. The secret
// never leaves the server through the API — only this in-process call and
// the key file the sidecar reads.
func (s *Service) LiveKitKeys(ctx context.Context) (LiveKitCredentials, error) {
	var k LiveKitCredentials
	if _, err := s.readJSON(ctx, keyLiveKit, &k); err != nil {
		return LiveKitCredentials{}, err
	}
	return k, nil
}

// SetLiveKitKeys stores a pair, so a minted one survives a restart.
func (s *Service) SetLiveKitKeys(ctx context.Context, k LiveKitCredentials) error {
	return s.writeJSON(ctx, keyLiveKit, k)
}

// TailscaleController is the instance module's port to the built-in
// listener: apply settings, report status. Implemented by
// tailnet.Manager, wired in internal/app.
type TailscaleController interface {
	Apply(TailscaleSettings)
	Status(ctx context.Context) TailscaleStatus
}

// LiveKitStatus is whether the voice sidecar is up, and where.
type LiveKitStatus struct {
	Running bool
	URL     string
}

// LiveKitReporter is the instance module's port onto the voice sidecar's
// state, wired in internal/app (which is the only place that knows both
// the configuration and the Tailscale node).
type LiveKitReporter interface {
	LiveKitStatus(ctx context.Context) LiveKitStatus
}

// UseLiveKit connects the reporter; nil means nothing is known and the
// admin page shows voice as unconfigured.
func (s *Service) UseLiveKit(r LiveKitReporter) { s.livekit = r }

// ReachabilityEnv is what the environment provides; the fallback for any
// value with nothing saved.
type ReachabilityEnv struct {
	Reachability
	VoiceConfigured bool
}

// TailscaleStatus is reported by the built-in Tailscale listener.
type TailscaleStatus struct {
	Enabled  bool
	State    string
	LoginURL string
	URL      string
	Funnel   bool
	Error    string
	// TailnetIP is the node's 100.x address; the one LiveKit is told to
	// advertise so voice over the tailnet finds the media ports.
	TailnetIP string
	// CarriesVoice reports whether the node is relaying LiveKit's media
	// ports.
	CarriesVoice bool
}

// ReachabilityEnvValue returns the environment fallback as it stands, so
// a caller can adjust one field and hand it back.
func (s *Service) ReachabilityEnvValue() ReachabilityEnv { return s.env }

// UseReachabilityEnv supplies the environment fallback.
func (s *Service) UseReachabilityEnv(env ReachabilityEnv) { s.env = env }

// UseTailscale connects the built-in listener; nil means the build has
// none. The settings in force are applied right away.
func (s *Service) UseTailscale(ctx context.Context, c TailscaleController) error {
	s.tailscale = c
	if c == nil {
		return nil
	}
	r, err := s.Reachability(ctx)
	if err != nil {
		return err
	}
	c.Apply(r.Tailscale)
	return nil
}

func (s *Service) readJSON(ctx context.Context, key string, into any) (bool, error) {
	raw, err := s.q.GetSetting(ctx, key)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read %s: %w", key, err)
	}
	if err := json.Unmarshal(raw, into); err != nil {
		return false, fmt.Errorf("decode %s: %w", key, err)
	}
	return true, nil
}

func (s *Service) writeJSON(ctx context.Context, key string, v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if err := s.q.UpsertSetting(ctx, dbgen.UpsertSettingParams{Key: key, Value: raw}); err != nil {
		return fmt.Errorf("write %s: %w", key, err)
	}
	return nil
}

// Reachability is the effective configuration: saved values first, the
// environment otherwise.
func (s *Service) Reachability(ctx context.Context) (Reachability, error) {
	r := s.env.Reachability
	// Clearing the public URL from the form saves "" rather than deleting
	// the key; like PublicURL, treat that as "fall back to the environment".
	var pu string
	if ok, err := s.readJSON(ctx, keyPublicURL, &pu); err != nil {
		return r, err
	} else if ok && pu != "" {
		r.PublicURL = pu
	}
	var t TURNRelay
	if ok, err := s.readJSON(ctx, keyTURN, &t); err != nil {
		return r, err
	} else if ok {
		r.TURN = t
	}
	var cf CloudflareTURN
	if ok, err := s.readJSON(ctx, keyCloudflareTURN, &cf); err != nil {
		return r, err
	} else if ok {
		r.Cloudflare = cf
	}
	var ts TailscaleSettings
	if ok, err := s.readJSON(ctx, keyTailscale, &ts); err != nil {
		return r, err
	} else if ok {
		r.Tailscale = ts
	}
	tp, err := s.trustedProxies(ctx)
	if err != nil {
		return r, err
	}
	r.TrustedProxies = tp
	return r, nil
}

// trustedProxies resolves the saved address list, falling back to the
// environment (STOOP_TRUST_PROXY=true trusts every peer) when none is
// saved. A saved-but-empty list means "trust nothing" only if the
// environment doesn't say otherwise — same convention as the rest: an
// empty saved value falls back.
func (s *Service) trustedProxies(ctx context.Context) (trustedproxy.Set, error) {
	var saved []string
	ok, err := s.readJSON(ctx, keyTrustedProxies, &saved)
	if err != nil {
		return trustedproxy.Set{}, err
	}
	if ok && len(saved) > 0 {
		set, err := trustedproxy.Parse(saved)
		if err != nil {
			// Saved values were validated on the way in; a bad one here
			// means hand-edited settings. Trust nothing rather than guess.
			return trustedproxy.Set{}, nil
		}
		return set, nil
	}
	return s.env.TrustedProxies, nil
}

// LoadTrustedProxies primes the cache that TrustsPeer reads. Called once
// at startup; UpdateReachability refreshes it on every save, so a change
// takes effect on the next request without a restart.
func (s *Service) LoadTrustedProxies(ctx context.Context) error {
	set, err := s.trustedProxies(ctx)
	if err != nil {
		return err
	}
	s.trusted.Store(&set)
	return nil
}

// TrustsPeer reports whether remoteAddr is a proxy whose forwarded
// headers may be believed. Read on every request, so it never touches the
// database: the answer comes from the cache LoadTrustedProxies fills.
func (s *Service) TrustsPeer(remoteAddr string) bool {
	set := s.trusted.Load()
	if set == nil {
		return false
	}
	return set.Trusted(remoteAddr)
}

// PublicURL is the effective public address: saved, else environment or
// the built-in Tailscale listener's address (via UsePublicURL).
func (s *Service) PublicURL(ctx context.Context) (string, error) {
	var pu string
	ok, err := s.readJSON(ctx, keyPublicURL, &pu)
	if err != nil {
		return "", err
	}
	if ok && pu != "" {
		return pu, nil
	}
	if s.env.PublicURL != "" {
		return s.env.PublicURL, nil
	}
	return s.publicURL(), nil
}

func validatePublicURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return "", connect.NewError(connect.CodeInvalidArgument,
			errors.New("public_url must look like https://chat.example.com"))
	}
	return strings.TrimSuffix(raw, "/"), nil
}

func validateTURN(t TURNRelay) error {
	for _, u := range append(append([]string{}, t.URLs...), t.STUNURLs...) {
		if !strings.HasPrefix(u, "turn:") && !strings.HasPrefix(u, "turns:") && !strings.HasPrefix(u, "stun:") && !strings.HasPrefix(u, "stuns:") {
			return connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("%q is not a turn:, turns:, stun:, or stuns: URL", u))
		}
	}
	if len(t.URLs) > 0 && (t.Username == "" || t.Credential == "") {
		return connect.NewError(connect.CodeInvalidArgument,
			errors.New("a TURN relay needs a username and credential"))
	}
	return nil
}

func (s *Service) GetReachability(ctx context.Context, _ *connect.Request[instancev1.GetReachabilityRequest]) (*connect.Response[instancev1.GetReachabilityResponse], error) {
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	resp, err := s.reachabilityResponse(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s *Service) UpdateReachability(ctx context.Context, req *connect.Request[instancev1.UpdateReachabilityRequest]) (*connect.Response[instancev1.UpdateReachabilityResponse], error) {
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	if req.Msg.PublicUrl != nil {
		pu := strings.TrimSpace(*req.Msg.PublicUrl)
		if pu != "" {
			var err error
			if pu, err = validatePublicURL(pu); err != nil {
				return nil, err
			}
		}
		if err := s.writeJSON(ctx, keyPublicURL, pu); err != nil {
			return nil, err
		}
	}
	if req.Msg.Turn != nil {
		t := TURNRelay{
			URLs: trimAll(req.Msg.Turn.Urls), Username: strings.TrimSpace(req.Msg.Turn.Username),
			Credential: req.Msg.Turn.Credential, STUNURLs: trimAll(req.Msg.Turn.StunUrls),
		}
		if len(t.URLs) == 0 && len(t.STUNURLs) == 0 {
			t = TURNRelay{}
		} else {
			if t.Credential == "" {
				// The credential is write-only; a blank one keeps what's saved.
				var prev TURNRelay
				if _, err := s.readJSON(ctx, keyTURN, &prev); err != nil {
					return nil, err
				}
				t.Credential = prev.Credential
			}
			if err := validateTURN(t); err != nil {
				return nil, err
			}
		}
		if err := s.writeJSON(ctx, keyTURN, t); err != nil {
			return nil, err
		}
	}
	if req.Msg.Cloudflare != nil {
		cf := CloudflareTURN{KeyID: strings.TrimSpace(req.Msg.Cloudflare.KeyId), APIToken: strings.TrimSpace(req.Msg.Cloudflare.ApiToken)}
		if cf.KeyID == "" {
			cf = CloudflareTURN{}
		} else if cf.APIToken == "" {
			// Keep the saved token when only the key id is resent.
			var prev CloudflareTURN
			if _, err := s.readJSON(ctx, keyCloudflareTURN, &prev); err != nil {
				return nil, err
			}
			if prev.KeyID == cf.KeyID {
				cf.APIToken = prev.APIToken
			}
			if cf.APIToken == "" {
				return nil, connect.NewError(connect.CodeInvalidArgument,
					errors.New("cloudflare TURN needs the key's API token"))
			}
		}
		if err := s.writeJSON(ctx, keyCloudflareTURN, cf); err != nil {
			return nil, err
		}
	}
	if req.Msg.Tailscale != nil {
		in := req.Msg.Tailscale
		ts := TailscaleSettings{
			Enabled: in.Enabled, Hostname: strings.TrimSpace(in.Hostname), Funnel: in.Funnel,
			AuthKey: strings.TrimSpace(in.AuthKey), ControlURL: strings.TrimSpace(in.ControlUrl),
		}
		if ts.Hostname != "" && !validHostname(ts.Hostname) {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				errors.New("hostname must be letters, digits, and hyphens"))
		}
		if ts.ControlURL != "" {
			if u, err := url.Parse(ts.ControlURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
				return nil, connect.NewError(connect.CodeInvalidArgument,
					errors.New("control_url must be an http(s) URL"))
			}
		}
		if ts.AuthKey == "" {
			// Keep the saved key when the field is left blank.
			var prev TailscaleSettings
			if _, err := s.readJSON(ctx, keyTailscale, &prev); err != nil {
				return nil, err
			}
			ts.AuthKey = prev.AuthKey
		}
		if err := s.writeJSON(ctx, keyTailscale, ts); err != nil {
			return nil, err
		}
		if s.tailscale != nil {
			s.tailscale.Apply(ts)
		}
	}
	if req.Msg.TrustedProxies != nil {
		cidrs := trimAll(req.Msg.TrustedProxies.Cidrs)
		if len(cidrs) > maxTrustedProxies {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("at most %d trusted proxy addresses", maxTrustedProxies))
		}
		if _, err := trustedproxy.Parse(cidrs); err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
		if err := s.writeJSON(ctx, keyTrustedProxies, cidrs); err != nil {
			return nil, err
		}
	}
	// Applied without a restart: every request reads the cache, so
	// refreshing it here is all a change needs.
	if err := s.LoadTrustedProxies(ctx); err != nil {
		return nil, err
	}
	resp, err := s.reachabilityResponse(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.UpdateReachabilityResponse{Reachability: resp}), nil
}

func validHostname(h string) bool {
	if len(h) > 63 {
		return false
	}
	for i, c := range h {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case c == '-' && i > 0 && i < len(h)-1:
		default:
			return false
		}
	}
	return h != ""
}

func (s *Service) reachabilityResponse(ctx context.Context) (*instancev1.GetReachabilityResponse, error) {
	r, err := s.Reachability(ctx)
	if err != nil {
		return nil, err
	}
	resp := &instancev1.GetReachabilityResponse{
		Reachability: &instancev1.Reachability{
			PublicUrl: r.PublicURL,
			Turn: &instancev1.TurnRelay{
				Urls: r.TURN.URLs, Username: r.TURN.Username,
				HasCredential: r.TURN.Credential != "", StunUrls: r.TURN.STUNURLs,
			},
			Cloudflare: &instancev1.CloudflareTurn{
				KeyId: r.Cloudflare.KeyID, HasApiToken: r.Cloudflare.APIToken != "",
			},
			Tailscale: &instancev1.TailscaleSettings{
				Enabled: r.Tailscale.Enabled, Hostname: r.Tailscale.Hostname, Funnel: r.Tailscale.Funnel,
				HasAuthKey: r.Tailscale.AuthKey != "", ControlUrl: r.Tailscale.ControlURL,
			},
			TrustedProxies: &instancev1.TrustedProxies{
				Cidrs:    r.TrustedProxies.Strings(),
				TrustAll: r.TrustedProxies.TrustsEveryone(),
			},
		},
		Tailscale:       &instancev1.TailscaleStatus{},
		VoiceConfigured: s.env.VoiceConfigured,
		HostTailscale:   hostHasTailscale(),
		Livekit:         &instancev1.LiveKitStatus{},
	}
	if s.livekit != nil {
		lk := s.livekit.LiveKitStatus(ctx)
		resp.Livekit = &instancev1.LiveKitStatus{Running: lk.Running, Url: lk.URL}
	}
	if s.tailscale != nil {
		ts := s.tailscale.Status(ctx)
		resp.Tailscale = &instancev1.TailscaleStatus{
			Enabled: ts.Enabled, State: ts.State, LoginUrl: ts.LoginURL,
			Url: ts.URL, Funnel: ts.Funnel, Error: ts.Error,
			TailnetIp: ts.TailnetIP, CarriesVoice: ts.CarriesVoice,
		}
	}
	return resp, nil
}

func trimAll(in []string) []string {
	var out []string
	for _, v := range in {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out
}
