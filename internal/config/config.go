// Package config loads Stoop's configuration from STOOP_* environment
// variables. Env-only configuration keeps deployment 12-factor and
// docker-compose-native.
package config

import (
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type Config struct {
	// ListenAddr is the address the HTTP server binds to.
	ListenAddr string
	// DatabaseURL is a Postgres connection string. Required.
	DatabaseURL string
	// PublicURL is the address people use to reach this server
	// (https://chat.example.com). Invite links are built from it and its
	// host is always an allowed WebSocket origin. Empty means "whatever
	// address the browser used"; with the built-in Tailscale listener the
	// tailnet address is used when this is unset.
	PublicURL string
	// TrustProxy honours X-Forwarded-Proto from a reverse proxy in front of
	// the plain listener, so cookies issued through an HTTPS proxy are
	// Secure. Only enable it when a proxy you control is the only way to
	// reach ListenAddr.
	TrustProxy bool
	// SecureCookies forces session cookies Secure on every listener.
	// Usually unnecessary: cookies issued over TLS (the Tailscale
	// listener) or through a trusted HTTPS proxy are Secure already.
	SecureCookies bool
	// AllowedWSOrigins are host patterns permitted to open WebSocket
	// connections (e.g. "chat.example.com", "localhost:*").
	AllowedWSOrigins []string
	// AuthRateLimit caps Login and Register calls per client IP per minute
	// (burst of the same size). 0 disables it — for dev and the e2e
	// runner, never for a server anyone else can reach.
	AuthRateLimit int
	// SignalingRateLimit caps new LiveKit signaling connections per client
	// IP per minute. The proxy is unauthenticated (LiveKit checks the
	// token), so this is what stops it being an open relay. 0 disables.
	SignalingRateLimit int
	// SearchRateLimit caps SearchMessages calls per user per minute. 0
	// disables it.
	SearchRateLimit int
	// RegistrationPolicy seeds the instance setting on first boot only:
	// "open", "invite" (default), or "closed". Change it afterwards from
	// the admin page; the database wins over this value.
	RegistrationPolicy string

	// Storage selects the blob store behind file uploads: "fs" (default;
	// files under StorageDir) or "s3" (not yet implemented).
	Storage string
	// StorageDir is the fs store's root directory. Back it up alongside
	// Postgres.
	StorageDir string

	// LiveKit sidecar settings; empty until voice is configured.
	LiveKitURL string
	// LiveKitKeyFile is where the server writes the key pair for a LiveKit
	// sidecar to read with --key-file. Empty means <StorageDir>/livekit/keys.yaml.
	LiveKitKeyFile string
	// LiveKitNodeIPFile is where the server records the address LiveKit
	// should advertise to browsers, for a sidecar started with
	// NODE_IP="$(cat <file>)". Empty means alongside the key file, or
	// <StorageDir>/livekit/node-ip when that is unset too.
	LiveKitNodeIPFile string
	LiveKitAPIKey     string
	LiveKitAPISecret  string
	// Where LiveKit's media endpoints are reachable from this process,
	// and which ports they are. Only the built-in Tailscale node uses
	// these: it carries those ports over the tailnet and relays them
	// here. They must match the sidecar's rtc.tcp_port and
	// rtc.port_range_start/end.
	LiveKitMediaHost string
	LiveKitTCPPort   int
	LiveKitUDPStart  int
	LiveKitUDPEnd    int

	// TURN relays offered to browsers for voice when they can't reach
	// LiveKit's media ports directly (HTTP-only tunnels, CGNAT, strict
	// networks). Static server: TURNURLs + TURNUsername + TURNCredential,
	// optionally STUNURLs. Cloudflare: CloudflareTURNKeyID + APIToken;
	// Stoop mints short-lived credentials per join. Both may be set.
	TURNURLs               []string
	TURNUsername           string
	TURNCredential         string
	STUNURLs               []string
	CloudflareTURNKeyID    string
	CloudflareTURNAPIToken string

	// LinkPreviews has the server fetch metadata for links in messages
	// (Open Graph cards). The server does the fetching so readers' browsers
	// never contact the linked site; turn it off if you'd rather the server
	// made no outbound requests on members' behalf.
	LinkPreviews bool
	// FileSweepInterval is how often unreferenced uploads and stray blobs
	// are removed (0 disables the timer; the admin page can still run
	// one); FileSweepGrace is how old a file must be before it qualifies.
	FileSweepInterval time.Duration
	FileSweepGrace    time.Duration
	// ActivityRetention is how long read activity items are kept before
	// the sweep (same timer as the file sweep) removes them; 0 keeps
	// them forever.
	ActivityRetention time.Duration
	// UnfurlAllowPrivate lets link previews fetch private/loopback
	// addresses. Never in production: it's what stops the server being used
	// as a proxy into your LAN. Dev and tests only.
	UnfurlAllowPrivate bool

	// Tailscale embeds a tailnet node in the binary (tsnet) and serves the
	// app over HTTPS on its tailnet address, in addition to ListenAddr.
	Tailscale bool
	// TailscaleHostname is the node name on the tailnet ("stoop" →
	// https://stoop.<tailnet>.ts.net).
	TailscaleHostname string
	// TailscaleAuthKey pre-authorises the node. Without it, the server logs
	// a login URL on first start.
	TailscaleAuthKey string
	// TailscaleControlURL points at a self-hosted control server
	// (Headscale); empty means Tailscale's.
	TailscaleControlURL string
	// TailscaleFunnel additionally exposes the tailnet address to the
	// public internet through Tailscale Funnel.
	TailscaleFunnel bool
	// TailscaleVoice has the built-in node carry LiveKit's media ports as
	// well as HTTPS, so voice and video ride the tailnet with nothing
	// installed on the host. On by default; it does nothing unless both
	// the node and voice are configured.
	TailscaleVoice bool

	// OIDCIssuer configures one login provider from the environment (the
	// admin page can add more and overrides this). The issuer URL exactly
	// as the provider's discovery document states it.
	OIDCIssuer string
	// OIDCClientID and OIDCClientSecret come from the provider's console.
	OIDCClientID     string
	OIDCClientSecret string
	// OIDCName is the sign-in button's entire text.
	OIDCName string
	// OIDCID is the provider's stable id; it appears in the callback URL
	// (/auth/callback/<id>) and identities link under it.
	OIDCID string
	// PasswordSignIn is who may use the username/password form: everyone
	// (default), admins, or off. The admin page's saved value overrides it.
	PasswordSignIn string
	// InstanceName is STOOP_INSTANCE_NAME, shown in the browser tab. Empty
	// means: generate a random one on first boot (instance.Seed) rather
	// than call every instance "Stoop". The admin page's saved value
	// overrides either.
	InstanceName string
}

func Load() (Config, error) {
	cfg := Config{
		ListenAddr:        getenv("STOOP_LISTEN_ADDR", ":8080"),
		DatabaseURL:       os.Getenv("STOOP_DATABASE_URL"),
		LiveKitURL:        os.Getenv("STOOP_LIVEKIT_URL"),
		LiveKitKeyFile:    os.Getenv("STOOP_LIVEKIT_KEY_FILE"),
		LiveKitNodeIPFile: os.Getenv("STOOP_LIVEKIT_NODE_IP_FILE"),
		LiveKitAPIKey:     os.Getenv("STOOP_LIVEKIT_API_KEY"),
		LiveKitAPISecret:  os.Getenv("STOOP_LIVEKIT_API_SECRET"),
	}

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("STOOP_DATABASE_URL is required")
	}

	secure, err := parseBool("STOOP_SECURE_COOKIES", false)
	if err != nil {
		return Config{}, err
	}
	cfg.SecureCookies = secure

	cfg.RegistrationPolicy = getenv("STOOP_REGISTRATION", "invite")
	switch cfg.RegistrationPolicy {
	case "open", "invite", "closed":
	default:
		return Config{}, fmt.Errorf("STOOP_REGISTRATION must be open, invite, or closed (got %q)", cfg.RegistrationPolicy)
	}

	cfg.Storage = getenv("STOOP_STORAGE", "fs")
	switch cfg.Storage {
	case "fs":
	case "s3":
		return Config{}, fmt.Errorf("STOOP_STORAGE=s3 is not available yet; use fs")
	default:
		return Config{}, fmt.Errorf("STOOP_STORAGE must be fs or s3 (got %q)", cfg.Storage)
	}
	cfg.StorageDir = getenv("STOOP_STORAGE_DIR", "./data")

	if cfg.PublicURL = os.Getenv("STOOP_PUBLIC_URL"); cfg.PublicURL != "" {
		u, err := url.Parse(cfg.PublicURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || (u.Path != "" && u.Path != "/") {
			return Config{}, fmt.Errorf("STOOP_PUBLIC_URL must look like https://chat.example.com (got %q)", cfg.PublicURL)
		}
		cfg.PublicURL = strings.TrimSuffix(cfg.PublicURL, "/")
	}
	if cfg.TrustProxy, err = parseBool("STOOP_TRUST_PROXY", false); err != nil {
		return Config{}, err
	}

	cfg.TURNURLs = splitList(os.Getenv("STOOP_TURN_URLS"))
	cfg.TURNUsername = os.Getenv("STOOP_TURN_USERNAME")
	cfg.TURNCredential = os.Getenv("STOOP_TURN_CREDENTIAL")
	cfg.STUNURLs = splitList(os.Getenv("STOOP_STUN_URLS"))
	if len(cfg.TURNURLs) > 0 && (cfg.TURNUsername == "" || cfg.TURNCredential == "") {
		return Config{}, fmt.Errorf("STOOP_TURN_URLS needs STOOP_TURN_USERNAME and STOOP_TURN_CREDENTIAL")
	}
	cfg.CloudflareTURNKeyID = os.Getenv("STOOP_CLOUDFLARE_TURN_KEY_ID")
	cfg.CloudflareTURNAPIToken = os.Getenv("STOOP_CLOUDFLARE_TURN_API_TOKEN")
	if (cfg.CloudflareTURNKeyID == "") != (cfg.CloudflareTURNAPIToken == "") {
		return Config{}, fmt.Errorf("STOOP_CLOUDFLARE_TURN_KEY_ID and STOOP_CLOUDFLARE_TURN_API_TOKEN must be set together")
	}

	if cfg.LinkPreviews, err = parseBool("STOOP_LINK_PREVIEWS", true); err != nil {
		return Config{}, err
	}
	if cfg.UnfurlAllowPrivate, err = parseBool("STOOP_UNFURL_ALLOW_PRIVATE", false); err != nil {
		return Config{}, err
	}

	if cfg.Tailscale, err = parseBool("STOOP_TAILSCALE", false); err != nil {
		return Config{}, err
	}
	cfg.TailscaleHostname = getenv("STOOP_TAILSCALE_HOSTNAME", "stoop")
	cfg.TailscaleAuthKey = os.Getenv("STOOP_TAILSCALE_AUTHKEY")
	cfg.TailscaleControlURL = os.Getenv("STOOP_TAILSCALE_CONTROL_URL")
	if cfg.TailscaleFunnel, err = parseBool("STOOP_TAILSCALE_FUNNEL", false); err != nil {
		return Config{}, err
	}
	if cfg.TailscaleFunnel && !cfg.Tailscale {
		return Config{}, fmt.Errorf("STOOP_TAILSCALE_FUNNEL needs STOOP_TAILSCALE=true")
	}
	if cfg.TailscaleVoice, err = parseBool("STOOP_TAILSCALE_VOICE", true); err != nil {
		return Config{}, err
	}

	cfg.LiveKitMediaHost = getenv("STOOP_LIVEKIT_MEDIA_HOST", "127.0.0.1")
	if cfg.LiveKitTCPPort, err = parsePort("STOOP_LIVEKIT_TCP_PORT", 7881); err != nil {
		return Config{}, err
	}
	if cfg.LiveKitUDPStart, cfg.LiveKitUDPEnd, err = parsePortRange("STOOP_LIVEKIT_UDP_PORTS", "50000-50100"); err != nil {
		return Config{}, err
	}

	cfg.AllowedWSOrigins = splitList(getenv("STOOP_ALLOWED_WS_ORIGINS", "localhost:*,127.0.0.1:*"))
	if cfg.FileSweepInterval, err = parseDuration("STOOP_FILE_SWEEP_INTERVAL", "6h"); err != nil {
		return cfg, err
	}
	if cfg.FileSweepGrace, err = parseDuration("STOOP_FILE_SWEEP_GRACE", "24h"); err != nil {
		return cfg, err
	}
	if cfg.ActivityRetention, err = parseDuration("STOOP_ACTIVITY_RETENTION", "720h"); err != nil {
		return cfg, err
	}
	if cfg.AuthRateLimit, err = parseNonNegativeInt("STOOP_AUTH_RATE_LIMIT", 20); err != nil {
		return Config{}, err
	}
	if cfg.SignalingRateLimit, err = parseNonNegativeInt("STOOP_SIGNALING_RATE_LIMIT", 30); err != nil {
		return Config{}, err
	}
	if cfg.SearchRateLimit, err = parseNonNegativeInt("STOOP_SEARCH_RATE_LIMIT", 30); err != nil {
		return Config{}, err
	}
	if cfg.PublicURL != "" {
		if u, err := url.Parse(cfg.PublicURL); err == nil {
			cfg.AllowedWSOrigins = append(cfg.AllowedWSOrigins, u.Host)
		}
	}

	// Kept exactly as given: discovery requires a byte-identical issuer
	// match, and some issuers (Authentik) end in "/".
	cfg.OIDCIssuer = os.Getenv("STOOP_OIDC_ISSUER")
	cfg.OIDCClientID = os.Getenv("STOOP_OIDC_CLIENT_ID")
	cfg.OIDCClientSecret = os.Getenv("STOOP_OIDC_CLIENT_SECRET")
	cfg.OIDCName = getenv("STOOP_OIDC_NAME", "Continue with single sign-on")
	cfg.OIDCID = getenv("STOOP_OIDC_ID", "sso")
	if cfg.OIDCIssuer != "" {
		u, err := url.Parse(cfg.OIDCIssuer)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return Config{}, fmt.Errorf("STOOP_OIDC_ISSUER must look like https://auth.example.com (got %q)", cfg.OIDCIssuer)
		}
		if cfg.OIDCClientID == "" || cfg.OIDCClientSecret == "" {
			return Config{}, fmt.Errorf("STOOP_OIDC_ISSUER needs STOOP_OIDC_CLIENT_ID and STOOP_OIDC_CLIENT_SECRET")
		}
	} else if cfg.OIDCClientID != "" || cfg.OIDCClientSecret != "" {
		return Config{}, fmt.Errorf("STOOP_OIDC_CLIENT_ID and STOOP_OIDC_CLIENT_SECRET need STOOP_OIDC_ISSUER")
	}
	cfg.PasswordSignIn = getenv("STOOP_PASSWORD_SIGN_IN", "everyone")
	switch cfg.PasswordSignIn {
	case "everyone", "admins", "off":
	default:
		return Config{}, fmt.Errorf("STOOP_PASSWORD_SIGN_IN must be everyone, admins, or off (got %q)", cfg.PasswordSignIn)
	}
	if !oidcIDRE.MatchString(cfg.OIDCID) {
		return Config{}, fmt.Errorf("STOOP_OIDC_ID must be 2-32 of a-z, 0-9, -, _ (got %q)", cfg.OIDCID)
	}
	// Held to the same rules as a name saved on the admin page (instance
	// settings.go): trimmed, and at most 100 characters.
	cfg.InstanceName = strings.TrimSpace(os.Getenv("STOOP_INSTANCE_NAME"))
	if utf8.RuneCountInString(cfg.InstanceName) > 100 {
		return Config{}, fmt.Errorf("STOOP_INSTANCE_NAME must be 100 characters or fewer")
	}

	return cfg, nil
}

// oidcIDRE matches the provider-id rule enforced by the admin API too.
var oidcIDRE = regexp.MustCompile(`^[a-z0-9_-]{2,32}$`)

// splitList parses a comma-separated value, dropping blanks.
func splitList(v string) []string {
	var out []string
	for _, s := range strings.Split(v, ",") {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func parseBool(key string, fallback bool) (bool, error) {
	v, err := strconv.ParseBool(getenv(key, strconv.FormatBool(fallback)))
	if err != nil {
		return false, fmt.Errorf("%s: %w", key, err)
	}
	return v, nil
}

func parseDuration(key, fallback string) (time.Duration, error) {
	d, err := time.ParseDuration(getenv(key, fallback))
	if err != nil || d < 0 {
		return 0, fmt.Errorf("%s must be a duration like 6h or 30m, or 0 (got %q)", key, os.Getenv(key))
	}
	return d, nil
}

func parseNonNegativeInt(key string, fallback int) (int, error) {
	v, err := strconv.Atoi(getenv(key, strconv.Itoa(fallback)))
	if err != nil || v < 0 {
		return 0, fmt.Errorf("%s must be a whole number >= 0 (got %q)", key, os.Getenv(key))
	}
	return v, nil
}

func parsePort(key string, fallback int) (int, error) {
	v, err := strconv.Atoi(getenv(key, strconv.Itoa(fallback)))
	if err != nil || v < 1 || v > 65535 {
		return 0, fmt.Errorf("%s must be a port between 1 and 65535 (got %q)", key, os.Getenv(key))
	}
	return v, nil
}

// maxPortRange bounds how many UDP ports the Tailscale node will carry.
// LiveKit's default range is 101; a typo asking for tens of thousands of
// listeners should be rejected, not obeyed.
const maxPortRange = 4096

// parsePortRange reads an inclusive "start-end" range, or a single port.
func parsePortRange(key, fallback string) (int, int, error) {
	raw := getenv(key, fallback)
	bad := func() (int, int, error) {
		return 0, 0, fmt.Errorf("%s must be a port range like 50000-50100 (got %q)", key, raw)
	}
	start, end, ok := strings.Cut(raw, "-")
	if !ok {
		end = start
	}
	lo, err := strconv.Atoi(strings.TrimSpace(start))
	if err != nil {
		return bad()
	}
	hi, err := strconv.Atoi(strings.TrimSpace(end))
	if err != nil {
		return bad()
	}
	if lo < 1 || hi > 65535 || lo > hi {
		return bad()
	}
	if hi-lo+1 > maxPortRange {
		return 0, 0, fmt.Errorf("%s covers %d ports; %d is the most that will be carried",
			key, hi-lo+1, maxPortRange)
	}
	return lo, hi, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
