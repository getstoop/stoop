package instance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/trustedproxy"
)

// Reachability — how people reach this server — is pre-configured from
// the environment and then owned by the database: SeedFromEnv copies each
// group into a missing row at start, and a saved row, empty included, is
// the setting from then on. The environment is read directly only for a
// group with no row (a database wiped under a running server).

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
	// CloudflareTunnel is the connector; Cloudflare above is the TURN relay.
	CloudflareTunnel CloudflareTunnelSettings
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

// ReachabilityEnv is what the environment provides: the seed for a group
// with no row.
type ReachabilityEnv struct {
	Reachability
	VoiceConfigured bool
	// VoiceOff: the operator turned voice off (STOOP_VOICE=false).
	VoiceOff bool
}

// VoiceAvailable reports whether voice channels work on this server.
// Also chat's port.
func (s *Service) VoiceAvailable() bool { return s.env.VoiceConfigured }

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

// UseReachabilityEnv supplies the environment values.
func (s *Service) UseReachabilityEnv(env ReachabilityEnv) { s.env = env }

// UseVoiceConfigured records whether voice works here, which is known only
// once the voice module is built. Call it after UseReachabilityEnv.
func (s *Service) UseVoiceConfigured(configured bool) { s.env.VoiceConfigured = configured }

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
	return s.writeSettings(ctx, []settingWrite{{key, v}})
}

// settingWrite is one validated value waiting to be saved.
type settingWrite struct {
	key   string
	value any
}

// writeSettings saves every write or none, so a handler that validates
// first and then calls this once can't half-apply a refused save.
func (s *Service) writeSettings(ctx context.Context, writes []settingWrite) error {
	if len(writes) == 0 {
		return nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	queries := s.q.WithTx(tx)
	for _, write := range writes {
		raw, err := json.Marshal(write.value)
		if err != nil {
			return fmt.Errorf("encode %s: %w", write.key, err)
		}
		if err := queries.UpsertSetting(ctx, dbgen.UpsertSettingParams{Key: write.key, Value: raw}); err != nil {
			return fmt.Errorf("write %s: %w", write.key, err)
		}
	}
	return tx.Commit(ctx)
}

// keepSecret is the rule for write-only fields: a blank one keeps the
// secret in force.
func keepSecret(typed, current string) string {
	if typed != "" {
		return typed
	}
	return current
}

// Reachability is the configuration in force: each group's saved row,
// or the environment for a group with none.
func (s *Service) Reachability(ctx context.Context) (Reachability, error) {
	r := s.env.Reachability
	var pu string
	if ok, err := s.readJSON(ctx, keyPublicURL, &pu); err != nil {
		return r, err
	} else if ok {
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
	var ct CloudflareTunnelSettings
	if ok, err := s.readJSON(ctx, keyCloudflareTunnel, &ct); err != nil {
		return r, err
	} else if ok {
		r.CloudflareTunnel = ct
	}
	tp, err := s.trustedProxies(ctx)
	if err != nil {
		return r, err
	}
	r.TrustedProxies = tp
	return r, nil
}

// trustedProxies resolves the saved address list, or the environment's
// (STOOP_TRUSTED_PROXIES) when none is saved. A saved empty list trusts
// nothing.
func (s *Service) trustedProxies(ctx context.Context) (trustedproxy.Set, error) {
	var saved []string
	ok, err := s.readJSON(ctx, keyTrustedProxies, &saved)
	if err != nil {
		return trustedproxy.Set{}, err
	}
	if ok {
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

// PublicURL is the address in force, or the built-in Tailscale
// listener's address (via UsePublicURL) when none is set.
func (s *Service) PublicURL(ctx context.Context) (string, error) {
	r, err := s.Reachability(ctx)
	if err != nil {
		return "", err
	}
	if r.PublicURL != "" {
		return r.PublicURL, nil
	}
	return s.publicURL(), nil
}

func validatePublicURL(raw string) (string, error) {
	if !config.Origin(raw) {
		return "", apierr.Field(connect.CodeInvalidArgument, "public_url",
			errors.New("the public address must look like https://chat.example.com"))
	}
	return strings.TrimSuffix(raw, "/"), nil
}

func validateTURN(t TURNRelay) error {
	for _, list := range []struct {
		field string
		urls  []string
	}{{"turn.urls", t.URLs}, {"turn.stun_urls", t.STUNURLs}} {
		for _, u := range list.urls {
			if !strings.HasPrefix(u, "turn:") && !strings.HasPrefix(u, "turns:") && !strings.HasPrefix(u, "stun:") && !strings.HasPrefix(u, "stuns:") {
				return apierr.Field(connect.CodeInvalidArgument, list.field,
					fmt.Errorf("%q is not a turn:, turns:, stun:, or stuns: URL", u))
			}
		}
	}
	if len(t.URLs) > 0 && (t.Username == "" || t.Credential == "") {
		field := "turn.credential"
		if t.Username == "" {
			field = "turn.username"
		}
		return apierr.Field(connect.CodeInvalidArgument, field,
			errors.New("a TURN relay needs a username and credential"))
	}
	return nil
}

func (s *Service) GetReachability(ctx context.Context, _ *connect.Request[instancev1.GetReachabilityRequest]) (*connect.Response[instancev1.GetReachabilityResponse], error) {
	if err := apierr.RequireAction(ctx, authctx.InstanceRead); err != nil {
		return nil, err
	}
	resp, err := s.reachabilityResponse(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s *Service) UpdateReachability(ctx context.Context, req *connect.Request[instancev1.UpdateReachabilityRequest]) (*connect.Response[instancev1.UpdateReachabilityResponse], error) {
	if err := apierr.RequireAction(ctx, authctx.InstanceSettingsManage); err != nil {
		return nil, err
	}
	if err := s.SaveReachability(ctx, req.Msg); err != nil {
		return nil, err
	}
	resp, err := s.reachabilityResponse(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.UpdateReachabilityResponse{Reachability: resp}), nil
}

// SaveReachability saves the groups set in msg. Shared by the admin page
// and stoop admin, which checks no permission.
func (s *Service) SaveReachability(ctx context.Context, msg *instancev1.UpdateReachabilityRequest) error {
	current, err := s.Reachability(ctx)
	if err != nil {
		return err
	}
	// Every group is validated before anything is written, and the
	// controllers are told only once the writes have committed.
	var writes []settingWrite
	if msg.PublicUrl != nil {
		pu := strings.TrimSpace(*msg.PublicUrl)
		if pu != "" {
			if pu, err = validatePublicURL(pu); err != nil {
				return err
			}
		}
		writes = append(writes, settingWrite{keyPublicURL, pu})
	}
	if in := msg.Turn; in != nil {
		relay := TURNRelay{
			URLs: trimAll(in.Urls), Username: strings.TrimSpace(in.Username),
			Credential: keepSecret(in.Credential, current.TURN.Credential), STUNURLs: trimAll(in.StunUrls),
		}
		if len(relay.URLs) == 0 && len(relay.STUNURLs) == 0 {
			relay = TURNRelay{}
		} else if err := validateTURN(relay); err != nil {
			return err
		}
		writes = append(writes, settingWrite{keyTURN, relay})
	}
	if in := msg.Cloudflare; in != nil {
		cf := CloudflareTURN{KeyID: strings.TrimSpace(in.KeyId), APIToken: strings.TrimSpace(in.ApiToken)}
		if cf.KeyID == "" {
			cf = CloudflareTURN{}
		} else {
			// The token in force belongs to its key; a new key needs its own.
			if current.Cloudflare.KeyID == cf.KeyID {
				cf.APIToken = keepSecret(cf.APIToken, current.Cloudflare.APIToken)
			}
			if cf.APIToken == "" {
				return apierr.Field(connect.CodeInvalidArgument, "cloudflare.api_token",
					errors.New("cloudflare TURN needs the key's API token"))
			}
		}
		writes = append(writes, settingWrite{keyCloudflareTURN, cf})
	}
	var tailscale *TailscaleSettings
	if in := msg.Tailscale; in != nil {
		ts := TailscaleSettings{
			Enabled: in.Enabled, Hostname: strings.TrimSpace(in.Hostname), Funnel: in.Funnel,
			AuthKey:    keepSecret(strings.TrimSpace(in.AuthKey), current.Tailscale.AuthKey),
			ControlURL: strings.TrimSpace(in.ControlUrl),
		}
		if ts.Hostname != "" && !validHostname(ts.Hostname) {
			return apierr.Field(connect.CodeInvalidArgument, "tailscale.hostname",
				errors.New("the node name must be letters, digits, and hyphens"))
		}
		if ts.ControlURL != "" {
			if _, ok := config.HTTPURL(ts.ControlURL); !ok {
				return apierr.Field(connect.CodeInvalidArgument, "tailscale.control_url",
					errors.New("the control URL must be an http(s) URL"))
			}
		}
		tailscale = &ts
		writes = append(writes, settingWrite{keyTailscale, ts})
	}
	var tunnel *CloudflareTunnelSettings
	if in := msg.CloudflareTunnel; in != nil {
		ct, err := cloudflareTunnelSetting(in.Enabled, in.Token, current.CloudflareTunnel)
		if err != nil {
			return err
		}
		tunnel = &ct
		writes = append(writes, settingWrite{keyCloudflareTunnel, ct})
	}
	if msg.TrustedProxies != nil {
		cidrs := trimAll(msg.TrustedProxies.Cidrs)
		if len(cidrs) > maxTrustedProxies {
			return apierr.Field(connect.CodeInvalidArgument, "trusted_proxies.cidrs",
				fmt.Errorf("at most %d trusted proxy addresses", maxTrustedProxies))
		}
		if _, err := trustedproxy.Parse(cidrs); err != nil {
			return apierr.Field(connect.CodeInvalidArgument, "trusted_proxies.cidrs", err)
		}
		if cidrs == nil {
			cidrs = []string{}
		}
		writes = append(writes, settingWrite{keyTrustedProxies, cidrs})
	}
	if err := s.writeSettings(ctx, writes); err != nil {
		return err
	}
	if tailscale != nil && s.tailscale != nil {
		s.tailscale.Apply(*tailscale)
	}
	if tunnel != nil && s.tunnel != nil {
		s.tunnel.Apply(*tunnel)
	}
	// Applied without a restart: every request reads the cache, so
	// refreshing it here is all a change needs.
	return s.LoadTrustedProxies(ctx)
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
				Cidrs: r.TrustedProxies.Strings(),
			},
			CloudflareTunnel: &instancev1.CloudflareTunnelSettings{
				Enabled: r.CloudflareTunnel.Enabled, HasToken: r.CloudflareTunnel.Token != "",
			},
		},
		Tailscale:        &instancev1.TailscaleStatus{},
		VoiceConfigured:  s.env.VoiceConfigured,
		VoiceOff:         s.env.VoiceOff,
		HostTailscale:    hostHasTailscale(),
		Livekit:          &instancev1.LiveKitStatus{},
		CloudflareTunnel: &instancev1.CloudflareTunnelStatus{},
	}
	if s.tunnel != nil {
		ct := s.tunnel.Status()
		resp.CloudflareTunnel = &instancev1.CloudflareTunnelStatus{
			Enabled: ct.Enabled, State: ct.State, Error: ct.Error,
		}
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
