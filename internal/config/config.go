// Package config loads Stoop's configuration from STOOP_* environment
// variables. Env-only configuration keeps deployment 12-factor and
// docker-compose-native.
package config

import (
	"net/url"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/getstoop/stoop/internal/trustedproxy"
)

// STOOP_JOBS: where the job dispatcher runs.
const (
	JobsEmbedded = "embedded"
	JobsExternal = "external"
	JobsChild    = "child"
)

type Config struct {
	// ListenAddr is the address the HTTP server binds to.
	ListenAddr string
	// DatabaseURL is a Postgres connection string. Required.
	DatabaseURL string
	// DatabasePoolMax caps the connection pool. 0 leaves pgx's default,
	// max(4, CPUs).
	DatabasePoolMax int
	// DatabasePoolMaxShadowsURL is set when DatabaseURL carries
	// pool_max_conns too; DatabasePoolMax wins.
	DatabasePoolMaxShadowsURL bool
	// PublicURL is the address people use to reach this server
	// (https://chat.example.com). Invite links are built from it and its
	// host is always an allowed WebSocket origin. Empty means "whatever
	// address the browser used"; with the built-in Tailscale listener the
	// tailnet address is used when this is unset.
	PublicURL string
	// TrustedProxies names the proxies whose forwarded headers are
	// believed. The admin page's saved list overrides it.
	TrustedProxies trustedproxy.Set
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
	// files under StorageDir). "s3" is reserved and refused: an
	// object-storage backend is not built (STOOP-221).
	Storage string
	// StorageDir is the fs store's root directory. Back it up alongside
	// Postgres.
	StorageDir string

	// Voice false makes this a text-only server: LiveKit is ignored even
	// when configured, and no key pair is minted or written.
	Voice bool
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
	// UpdateCheck has the server read the release index on getstoop.org
	// so the admin page can say a newer release exists.
	UpdateCheck bool
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
	// Webhooks is the floor under the instance's webhook settings: false
	// stops every incoming post and outgoing delivery without deleting
	// anything.
	Webhooks bool
	// WebhookRateLimit is posts per minute per incoming hook; 0 disables.
	WebhookRateLimit int
	// WebhookDeliveryRetention is how long finished outgoing deliveries
	// are kept for the log; 0 keeps them forever.
	WebhookDeliveryRetention time.Duration

	// JobsWorkers is how many background jobs run at once.
	JobsWorkers int
	// JobsPoll is how often the dispatcher looks for due jobs.
	JobsPoll time.Duration
	// Jobs is where the job dispatcher runs: JobsEmbedded in this process,
	// JobsExternal nowhere in it, JobsChild in a `stoop jobs` it starts.
	Jobs string
	// JobsRetention is how long finished job rows are kept; 0 keeps them
	// forever.
	JobsRetention time.Duration

	// CloudflareTunnel runs cloudflared as a child process with
	// CloudflareTunnelToken, a remotely managed tunnel's token.
	CloudflareTunnel      bool
	CloudflareTunnelToken string
	// CloudflaredPath is where cloudflared is; empty looks on PATH.
	CloudflaredPath string

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
	// SessionLifetimeDays is how long a sign-in lasts. The admin page's
	// saved value overrides it.
	SessionLifetimeDays int
	// PasswordSignIn is who may use the username/password form: everyone
	// (default), admins, or off. The admin page's saved value overrides it.
	PasswordSignIn string
	// InstanceName is STOOP_INSTANCE_NAME, shown in the browser tab. Empty
	// means: generate a random one on first boot (instance.Seed) rather
	// than call every instance "Stoop". The admin page's saved value
	// overrides either.
	InstanceName string
	// DevWebURL is STOOP_DEV_WEB_URL: a Vite dev server to serve the web
	// app from instead of the embedded build. `make dev` sets it, and only
	// it should — the script policy is relaxed for hot reload.
	DevWebURL string
}

// Load reads the configuration, refusing every bad variable at once.
func Load() (Config, error) {
	env := &envReader{}
	cfg := Config{
		ListenAddr:         getenv("STOOP_LISTEN_ADDR", ":8080"),
		DatabaseURL:        os.Getenv("STOOP_DATABASE_URL"),
		DatabasePoolMax:    env.nonNegativeInt("STOOP_DATABASE_POOL_MAX", 0),
		SecureCookies:      env.bool("STOOP_SECURE_COOKIES", false),
		RegistrationPolicy: env.oneOf("STOOP_REGISTRATION", "invite", "open", "invite", "closed"),
		StorageDir:         getenv("STOOP_STORAGE_DIR", "./data"),
		LinkPreviews:       env.bool("STOOP_LINK_PREVIEWS", true),
		UpdateCheck:        env.bool("STOOP_UPDATE_CHECK", true),
		UnfurlAllowPrivate: env.bool("STOOP_UNFURL_ALLOW_PRIVATE", false),
		FileSweepInterval:  env.duration("STOOP_FILE_SWEEP_INTERVAL", 6*time.Hour),
		FileSweepGrace:     env.duration("STOOP_FILE_SWEEP_GRACE", 24*time.Hour),
		ActivityRetention:  env.duration("STOOP_ACTIVITY_RETENTION", 720*time.Hour),
		AuthRateLimit:      env.nonNegativeInt("STOOP_AUTH_RATE_LIMIT", 20),
		SignalingRateLimit: env.nonNegativeInt("STOOP_SIGNALING_RATE_LIMIT", 30),
		SearchRateLimit:    env.nonNegativeInt("STOOP_SEARCH_RATE_LIMIT", 30),
		PasswordSignIn:     env.oneOf("STOOP_PASSWORD_SIGN_IN", "everyone", "everyone", "admins", "off"),
		DevWebURL:          os.Getenv("STOOP_DEV_WEB_URL"),

		Webhooks:                 env.bool("STOOP_WEBHOOKS", true),
		WebhookRateLimit:         env.nonNegativeInt("STOOP_WEBHOOK_RATE_LIMIT", 60),
		WebhookDeliveryRetention: env.duration("STOOP_WEBHOOK_DELIVERY_RETENTION", 168*time.Hour),
	}

	if cfg.DatabaseURL == "" {
		env.fail("STOOP_DATABASE_URL is required")
	}
	if cfg.DatabasePoolMax == 1 {
		env.fail("STOOP_DATABASE_POOL_MAX must be at least 2: a request needs a connection while a sweep holds one")
	}
	cfg.DatabasePoolMaxShadowsURL = cfg.DatabasePoolMax > 0 && strings.Contains(cfg.DatabaseURL, "pool_max_conns")

	cfg.Storage = getenv("STOOP_STORAGE", "fs")
	switch cfg.Storage {
	case "fs":
	case "s3":
		env.fail("STOOP_STORAGE=s3 is not built; use fs")
	default:
		env.fail("STOOP_STORAGE must be fs or s3 (got %q)", cfg.Storage)
	}

	cfg.SessionLifetimeDays = env.nonNegativeInt("STOOP_SESSION_LIFETIME_DAYS", DefaultSessionLifetimeDays)
	if cfg.SessionLifetimeDays < 1 || cfg.SessionLifetimeDays > MaxSessionLifetimeDays {
		env.fail("STOOP_SESSION_LIFETIME_DAYS must be 1-%d (got %d)", MaxSessionLifetimeDays, cfg.SessionLifetimeDays)
	}
	// Held to the same rules as a name saved on the admin page (instance
	// settings.go): trimmed, and at most 100 characters.
	cfg.InstanceName = strings.TrimSpace(os.Getenv("STOOP_INSTANCE_NAME"))
	if utf8.RuneCountInString(cfg.InstanceName) > MaxInstanceNameRunes {
		env.fail("STOOP_INSTANCE_NAME must be 100 characters or fewer")
	}

	loadFrontDoors(env, &cfg)
	loadVoice(env, &cfg)
	loadJobs(env, &cfg)
	loadOIDC(env, &cfg)

	if err := env.err(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// loadFrontDoors reads how people reach the server: its public address,
// the proxies in front of it, and the built-in tunnel and tailnet node.
func loadFrontDoors(env *envReader, cfg *Config) {
	cfg.AllowedWSOrigins = splitList(getenv("STOOP_ALLOWED_WS_ORIGINS", "localhost:*,127.0.0.1:*"))
	if publicURL := os.Getenv("STOOP_PUBLIC_URL"); publicURL != "" {
		parsed, err := url.Parse(publicURL)
		if err != nil || !Origin(publicURL) {
			env.fail("STOOP_PUBLIC_URL must look like https://chat.example.com (got %q)", publicURL)
		} else {
			cfg.PublicURL = strings.TrimSuffix(publicURL, "/")
			cfg.AllowedWSOrigins = append(cfg.AllowedWSOrigins, parsed.Host)
		}
	}

	// Removed in 0.4.0. Compose loads .env whole, so an operator who
	// upgrades past 0.4.0 with it still set true is told instead of
	// silently trusting nothing.
	if env.bool("STOOP_TRUST_PROXY", false) {
		env.fail("STOOP_TRUST_PROXY=true is no longer supported: name your proxy's addresses in STOOP_TRUSTED_PROXIES and remove STOOP_TRUST_PROXY")
	}
	proxies, err := trustedproxy.Parse(splitList(os.Getenv("STOOP_TRUSTED_PROXIES")))
	if err != nil {
		env.fail("STOOP_TRUSTED_PROXIES: %w", err)
	}
	cfg.TrustedProxies = proxies

	cfg.CloudflareTunnel = env.bool("STOOP_CLOUDFLARE_TUNNEL", false)
	cfg.CloudflareTunnelToken = os.Getenv("STOOP_CLOUDFLARE_TUNNEL_TOKEN")
	if cfg.CloudflareTunnel && cfg.CloudflareTunnelToken == "" {
		env.fail("STOOP_CLOUDFLARE_TUNNEL needs STOOP_CLOUDFLARE_TUNNEL_TOKEN")
	}
	cfg.CloudflaredPath = os.Getenv("STOOP_CLOUDFLARED_PATH")

	cfg.Tailscale = env.bool("STOOP_TAILSCALE", false)
	cfg.TailscaleHostname = getenv("STOOP_TAILSCALE_HOSTNAME", "stoop")
	cfg.TailscaleAuthKey = os.Getenv("STOOP_TAILSCALE_AUTHKEY")
	cfg.TailscaleControlURL = os.Getenv("STOOP_TAILSCALE_CONTROL_URL")
	cfg.TailscaleFunnel = env.bool("STOOP_TAILSCALE_FUNNEL", false)
	if cfg.TailscaleFunnel && !cfg.Tailscale && !env.refused["STOOP_TAILSCALE"] {
		env.fail("STOOP_TAILSCALE_FUNNEL needs STOOP_TAILSCALE=true")
	}
	cfg.TailscaleVoice = env.bool("STOOP_TAILSCALE_VOICE", true)
}

// loadVoice reads the LiveKit sidecar and the relays offered to browsers.
func loadVoice(env *envReader, cfg *Config) {
	cfg.Voice = env.bool("STOOP_VOICE", true)
	cfg.LiveKitURL = os.Getenv("STOOP_LIVEKIT_URL")
	cfg.LiveKitKeyFile = os.Getenv("STOOP_LIVEKIT_KEY_FILE")
	cfg.LiveKitNodeIPFile = os.Getenv("STOOP_LIVEKIT_NODE_IP_FILE")
	cfg.LiveKitAPIKey = os.Getenv("STOOP_LIVEKIT_API_KEY")
	cfg.LiveKitAPISecret = os.Getenv("STOOP_LIVEKIT_API_SECRET")
	cfg.LiveKitMediaHost = getenv("STOOP_LIVEKIT_MEDIA_HOST", "127.0.0.1")
	cfg.LiveKitTCPPort = env.port("STOOP_LIVEKIT_TCP_PORT", 7881)
	cfg.LiveKitUDPStart, cfg.LiveKitUDPEnd = env.portRange("STOOP_LIVEKIT_UDP_PORTS", 50000, 50100)

	cfg.TURNURLs = splitList(os.Getenv("STOOP_TURN_URLS"))
	cfg.TURNUsername = os.Getenv("STOOP_TURN_USERNAME")
	cfg.TURNCredential = os.Getenv("STOOP_TURN_CREDENTIAL")
	cfg.STUNURLs = splitList(os.Getenv("STOOP_STUN_URLS"))
	if len(cfg.TURNURLs) > 0 && (cfg.TURNUsername == "" || cfg.TURNCredential == "") {
		env.fail("STOOP_TURN_URLS needs STOOP_TURN_USERNAME and STOOP_TURN_CREDENTIAL")
	}
	cfg.CloudflareTURNKeyID = os.Getenv("STOOP_CLOUDFLARE_TURN_KEY_ID")
	cfg.CloudflareTURNAPIToken = os.Getenv("STOOP_CLOUDFLARE_TURN_API_TOKEN")
	if (cfg.CloudflareTURNKeyID == "") != (cfg.CloudflareTURNAPIToken == "") {
		env.fail("STOOP_CLOUDFLARE_TURN_KEY_ID and STOOP_CLOUDFLARE_TURN_API_TOKEN must be set together")
	}
}

func loadJobs(env *envReader, cfg *Config) {
	cfg.Jobs = env.oneOf("STOOP_JOBS", JobsEmbedded, JobsEmbedded, JobsExternal, JobsChild)
	cfg.JobsWorkers = env.nonNegativeInt("STOOP_JOBS_WORKERS", 16)
	if cfg.JobsWorkers < 1 {
		env.fail("STOOP_JOBS_WORKERS must be at least 1 (got %d)", cfg.JobsWorkers)
	}
	cfg.JobsPoll = env.duration("STOOP_JOBS_POLL", 2*time.Second)
	if cfg.JobsPoll <= 0 {
		env.fail("STOOP_JOBS_POLL must be more than 0 (got %q)", os.Getenv("STOOP_JOBS_POLL"))
	}
	cfg.JobsRetention = env.duration("STOOP_JOBS_RETENTION", 168*time.Hour)
}

// loadOIDC reads the one login provider the environment can configure.
func loadOIDC(env *envReader, cfg *Config) {
	// Kept exactly as given: discovery requires a byte-identical issuer
	// match, and some issuers (Authentik) end in "/".
	cfg.OIDCIssuer = os.Getenv("STOOP_OIDC_ISSUER")
	cfg.OIDCClientID = os.Getenv("STOOP_OIDC_CLIENT_ID")
	cfg.OIDCClientSecret = os.Getenv("STOOP_OIDC_CLIENT_SECRET")
	cfg.OIDCName = getenv("STOOP_OIDC_NAME", "Continue with single sign-on")
	cfg.OIDCID = getenv("STOOP_OIDC_ID", "sso")
	if cfg.OIDCIssuer != "" {
		if !IssuerURL(cfg.OIDCIssuer) {
			env.fail("STOOP_OIDC_ISSUER must look like https://auth.example.com (got %q)", cfg.OIDCIssuer)
		}
		if cfg.OIDCClientID == "" || cfg.OIDCClientSecret == "" {
			env.fail("STOOP_OIDC_ISSUER needs STOOP_OIDC_CLIENT_ID and STOOP_OIDC_CLIENT_SECRET")
		}
	} else if cfg.OIDCClientID != "" || cfg.OIDCClientSecret != "" {
		env.fail("STOOP_OIDC_CLIENT_ID and STOOP_OIDC_CLIENT_SECRET need STOOP_OIDC_ISSUER")
	}
	if !ValidProviderID(cfg.OIDCID) {
		env.fail("STOOP_OIDC_ID must be 2-32 of a-z, 0-9, -, _ (got %q)", cfg.OIDCID)
	}
}
