// Package app is the composition root — the only package that knows every
// module. It builds the database pool, runs migrations, constructs each
// module, wires their ports together, and mounts everything on one mux.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"path/filepath"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/gen/stoop/auth/v1/authv1connect"
	"github.com/getstoop/stoop/gen/stoop/chat/v1/chatv1connect"
	"github.com/getstoop/stoop/gen/stoop/files/v1/filesv1connect"
	"github.com/getstoop/stoop/gen/stoop/instance/v1/instancev1connect"
	"github.com/getstoop/stoop/gen/stoop/voice/v1/voicev1connect"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/blob"
	"github.com/getstoop/stoop/internal/buildinfo"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/files"
	"github.com/getstoop/stoop/internal/instance"
	"github.com/getstoop/stoop/internal/ratelimit"
	"github.com/getstoop/stoop/internal/realtime"
	"github.com/getstoop/stoop/internal/tailnet"
	"github.com/getstoop/stoop/internal/trustedproxy"
	"github.com/getstoop/stoop/internal/unfurl"
	"github.com/getstoop/stoop/internal/voice"
	"github.com/getstoop/stoop/internal/webui"
)

type App struct {
	server  *http.Server
	tailnet *tailnet.Manager
	nodeIP  *nodeIPWriter
	files   *files.Service
	chat    *chat.Service
	voice   *voice.Service
	sweep   time.Duration
	keep    time.Duration
	pool    *pgxpool.Pool
	log     *slog.Logger
}

func New(ctx context.Context, cfg config.Config, log *slog.Logger) (*App, error) {
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	if err := db.Migrate(ctx, pool); err != nil {
		pool.Close()
		return nil, err
	}

	bus := events.NewInProcBus()

	// The blob store is the only thing that touches file storage. Only
	// the filesystem backend exists today; config rejects anything else.
	store, err := blob.NewFS(cfg.StorageDir)
	if err != nil {
		pool.Close()
		return nil, err
	}
	log.Info("file storage", "backend", cfg.Storage, "dir", store.Root())

	authSvc := auth.New(pool, auth.Options{
		SecureCookies: cfg.SecureCookies,
		// Procedures other modules expose without a session.
		PublicProcedures: []string{
			instancev1connect.InstanceServiceGetInstanceStatusProcedure,
			// An invited stranger sees the space behind their code before
			// they have an account to see it with.
			chatv1connect.ChatServiceLookupInviteProcedure,
		},
	})
	instanceSvc := instance.New(pool, userAdmin{authSvc})
	if err := instanceSvc.Seed(ctx, instance.Defaults{
		RegistrationPolicy: instance.Policy(cfg.RegistrationPolicy),
		InstanceNameEnv:    cfg.InstanceName,
	}); err != nil {
		pool.Close()
		return nil, err
	}
	chatSvc := chat.New(pool, bus, userDirectory{authSvc})
	// auth ↔ instance/chat is the one cyclic pair of ports; it's closed
	// with a setter after both sides exist.
	authSvc.UseRegistrationPorts(instanceSvc, chatSvc)
	authSvc.UseProviders(providerSource{instanceSvc})
	authSvc.UsePasswordPolicy(instanceSvc)
	instanceSvc.UsePasswordSignInEnv(cfg.PasswordSignIn)
	bi := buildinfo.Get()
	instanceSvc.UseBuildInfo(instance.BuildInfo{Version: bi.Version, Commit: bi.Commit, BuiltAt: bi.Date, GoVersion: bi.GoVersion})
	chatSvc.UseInstancePolicy(instanceSvc)
	keys, err := livekitKeys(ctx, cfg, instanceSvc, log)
	if err != nil {
		pool.Close()
		return nil, err
	}
	voiceOpts := voice.Options{
		LiveKitURL:       cfg.LiveKitURL,
		LiveKitAPIKey:    keys.APIKey,
		LiveKitAPISecret: keys.APISecret,
	}
	voiceSvc := voice.New(chatSvc, displayNames{authSvc}, voiceOpts, log)
	// The other direction: chat ends calls through the SFU.
	chatSvc.UseVoiceRooms(voiceSvc)
	gateway := realtime.NewGateway(bus, sessionVerifier{authSvc}, chatSvc, chatSvc, cfg.AllowedWSOrigins, log)
	chatSvc.UsePresence(gateway)
	filesSvc := files.New(pool, store, bus, authSvc, chatSvc, identityVerifier{authSvc}, log)
	filesSvc.UsePolicy(instanceSvc)
	instanceSvc.UseUploadCeiling(files.MaxAttachmentBytes)
	filesSvc.UseSweepGrace(cfg.FileSweepGrace)
	chatSvc.UseFiles(fileDirectory{filesSvc})
	if cfg.LinkPreviews {
		chatSvc.UseUnfurler(unfurler{unfurl.New(unfurl.Options{AllowPrivate: cfg.UnfurlAllowPrivate})}, filesSvc, chat.UnfurlOptions{})
		if cfg.UnfurlAllowPrivate {
			log.Warn("link previews may fetch private addresses (STOOP_UNFURL_ALLOW_PRIVATE); never use this outside development")
		}
	}

	// Anonymous-endpoint throttles. Login, Register and the invite lookup
	// are the only Connect procedures worth guessing at; the signaling
	// proxy is the only plain handler without a session check. Both are per client IP, so behind
	// a proxy STOOP_TRUST_PROXY must be on or every user shares a bucket.
	authLimiter := ratelimit.New(cfg.AuthRateLimit, cfg.AuthRateLimit)
	signalingLimiter := ratelimit.New(cfg.SignalingRateLimit, cfg.SignalingRateLimit)
	if !authLimiter.Enabled() || !signalingLimiter.Enabled() {
		log.Warn("rate limiting is disabled for some anonymous endpoints; fine for dev, not for a reachable server",
			"auth_per_minute", cfg.AuthRateLimit, "signaling_per_minute", cfg.SignalingRateLimit)
	}

	// maxRequestBytes bounds any single Connect message. The largest
	// legitimate payload is an avatar/icon upload (≤ 2 MB of image bytes).
	const maxRequestBytes = 4 << 20
	interceptors := connect.WithHandlerOptions(
		connect.WithReadMaxBytes(maxRequestBytes),
		connect.WithInterceptors(
			ratelimit.Interceptor(authLimiter, instanceSvc.TrustsPeer,
				authv1connect.AuthServiceLoginProcedure,
				authv1connect.AuthServiceRegisterProcedure,
				chatv1connect.ChatServiceLookupInviteProcedure),
			authSvc.NewInterceptor()),
	)

	mux := http.NewServeMux()
	mux.Handle(authv1connect.NewAuthServiceHandler(authSvc, interceptors))
	mux.Handle(chatv1connect.NewChatServiceHandler(chatSvc, interceptors))
	mux.Handle(instancev1connect.NewInstanceServiceHandler(instanceSvc, interceptors))
	mux.Handle(voicev1connect.NewVoiceServiceHandler(voiceSvc, interceptors))
	mux.Handle(filesv1connect.NewFileServiceHandler(filesSvc, interceptors))
	mux.Handle("POST /files/upload", filesSvc.UploadHandler())
	mux.Handle("GET /files/{id}", filesSvc.Handler())
	mux.Handle("HEAD /files/{id}", filesSvc.Handler())
	mux.Handle("/ws", gateway)
	// Provider sign-in (OIDC): browser redirects, not Connect RPCs. Same
	// rate-limit bucket as Login/Register.
	mux.Handle("/auth/", ratelimit.Middleware(authLimiter, instanceSvc.TrustsPeer, authSvc.LoginHandler()))
	livekitProxy, err := voiceSvc.SignalingProxy()
	if err != nil {
		return nil, fmt.Errorf("STOOP_LIVEKIT_URL: %w", err)
	}
	mux.Handle(voice.SignalingPath+"/", ratelimit.Middleware(signalingLimiter, instanceSvc.TrustsPeer, livekitProxy))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.Handle("/", webui.Handler())
	// secureTransport is outermost: the headers below it read the TLS
	// verdict it puts on the context.
	handler := secureTransport(securityHeaders(mux, webui.ScriptHashes()), instanceSvc.TrustsPeer)

	a := &App{
		server: &http.Server{
			Addr:              cfg.ListenAddr,
			Handler:           handler,
			ReadHeaderTimeout: 10 * time.Second,
		},
		files: filesSvc,
		chat:  chatSvc,
		voice: voiceSvc,
		sweep: cfg.FileSweepInterval,
		keep:  cfg.ActivityRetention,
		pool:  pool,
		log:   log,
	}
	a.tailnet = tailnet.NewManager(filepath.Join(cfg.StorageDir, "tailscale"), handler, log)
	// The built-in node carries LiveKit's media ports as well as HTTPS, so
	// voice rides the tailnet with nothing installed on the host. Only
	// worth doing when there is a LiveKit to relay to.
	if cfg.TailscaleVoice && voiceSvc.Enabled() {
		a.tailnet.UseMedia(tailnet.Media{
			Host:     cfg.LiveKitMediaHost,
			TCPPort:  cfg.LiveKitTCPPort,
			UDPStart: cfg.LiveKitUDPStart,
			UDPEnd:   cfg.LiveKitUDPEnd,
		})
		// Carrying the ports is half of it: LiveKit also has to offer the
		// node's address to browsers, and it only reads that at startup.
		// Stoop writes it where the sidecar picks it up.
		a.nodeIP = newNodeIPWriter(cfg, log)
		a.tailnet.UseAddressHook(a.nodeIP.set)
	}

	// Reachability: saved settings override these environment values; the
	// tailnet address is the last-resort public URL.
	instanceSvc.UseReachabilityEnv(instance.ReachabilityEnv{
		Reachability: instance.Reachability{
			PublicURL: cfg.PublicURL,
			TURN: instance.TURNRelay{
				URLs: cfg.TURNURLs, Username: cfg.TURNUsername, Credential: cfg.TURNCredential,
				STUNURLs: cfg.STUNURLs,
			},
			Cloudflare: instance.CloudflareTURN{KeyID: cfg.CloudflareTURNKeyID, APIToken: cfg.CloudflareTURNAPIToken},
			Tailscale: instance.TailscaleSettings{
				Enabled: cfg.Tailscale, Hostname: cfg.TailscaleHostname, Funnel: cfg.TailscaleFunnel,
				AuthKey: cfg.TailscaleAuthKey, ControlURL: cfg.TailscaleControlURL,
			},
		},
		VoiceConfigured: voiceSvc.Enabled(),
	})
	// One login provider can come from the environment; the admin page's
	// saved list overrides it (same fallback rule as reachability).
	if cfg.OIDCIssuer != "" {
		instanceSvc.UseLoginProvidersEnv([]instance.LoginProvider{{
			ID: cfg.OIDCID, Kind: instance.KindOIDC, DisplayName: cfg.OIDCName,
			Icon: "key", Issuer: cfg.OIDCIssuer,
			ClientID: cfg.OIDCClientID, ClientSecret: cfg.OIDCClientSecret,
		}})
	}
	// STOOP_TRUST_PROXY=true is the blunt older form: believe every peer.
	// Naming addresses on the admin page replaces it.
	if cfg.TrustProxy {
		env := instanceSvc.ReachabilityEnvValue()
		env.TrustedProxies = trustedproxy.All()
		instanceSvc.UseReachabilityEnv(env)
	}
	if err := instanceSvc.LoadTrustedProxies(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	voiceSvc.UseRelayProvider(relayProvider{instanceSvc})
	instanceSvc.UsePublicURL(a.tailnet.PublicURL)
	// What the Hosting page can say about the voice sidecar: whether it
	// is configured, whether it answers, and what Stoop has handed it.
	instanceSvc.UseLiveKit(newLiveKitReporter(cfg, voiceOpts))
	if err := instanceSvc.UseTailscale(ctx, tailscaleController{a.tailnet}); err != nil {
		pool.Close()
		return nil, err
	}
	return a, nil
}

// livekitKeys settles which API key pair signs room tokens, and leaves it
// where a LiveKit sidecar can read it.
//
// The environment wins, for anyone who already configured a pair by hand.
// Otherwise a saved pair is reused, and failing that one is minted and
// saved — so a fresh install has working voice without the operator
// copying a secret between two files, which was the single most common
// way to end up with working chat and a voice join that dies at 15s.
//
// The file is written every time (not only when minting) so that an
// environment-configured server also feeds the sidecar from one place.
// Nothing is minted while LiveKit is unconfigured: no URL, no voice.
func livekitKeys(ctx context.Context, cfg config.Config, store *instance.Service, log *slog.Logger) (voice.Keys, error) {
	if cfg.LiveKitURL == "" {
		return voice.Keys{}, nil
	}
	path := cfg.LiveKitKeyFile
	if path == "" {
		path = filepath.Join(cfg.StorageDir, "livekit", "keys.yaml")
	}
	keys := voice.Keys{APIKey: cfg.LiveKitAPIKey, APISecret: cfg.LiveKitAPISecret}
	if !keys.Valid() {
		saved, err := store.LiveKitKeys(ctx)
		if err != nil {
			return voice.Keys{}, fmt.Errorf("read saved LiveKit keys: %w", err)
		}
		keys = voice.Keys{APIKey: saved.APIKey, APISecret: saved.APISecret}
	}
	if !keys.Valid() {
		// A key file but no saved pair means the settings were lost
		// without the sidecar being restarted — a wiped database in
		// development, or Postgres restored from an older backup. Adopt
		// what the sidecar is already using rather than minting a pair it
		// would reject until someone restarted it.
		if adopted, err := voice.ReadKeyFile(path); err == nil && adopted.Valid() {
			keys = adopted
			if err := store.SetLiveKitKeys(ctx, instance.LiveKitCredentials{
				APIKey: keys.APIKey, APISecret: keys.APISecret,
			}); err != nil {
				return voice.Keys{}, fmt.Errorf("save adopted LiveKit keys: %w", err)
			}
			log.Info("adopted the LiveKit API key pair already in the key file", "api_key", keys.APIKey, "path", path)
		}
	}
	if !keys.Valid() {
		minted, err := voice.GenerateKeys()
		if err != nil {
			return voice.Keys{}, err
		}
		if err := store.SetLiveKitKeys(ctx, instance.LiveKitCredentials{
			APIKey: minted.APIKey, APISecret: minted.APISecret,
		}); err != nil {
			return voice.Keys{}, fmt.Errorf("save minted LiveKit keys: %w", err)
		}
		keys = minted
		log.Info("minted a LiveKit API key pair for this server", "api_key", keys.APIKey)
	}
	if err := voice.WriteKeyFile(path, keys); err != nil {
		// Not fatal: a sidecar configured its own way still works, and
		// refusing to boot over a key file would be worse than saying so.
		log.Warn("could not write the LiveKit key file; the sidecar needs the same pair some other way",
			"path", path, "error", err)
	}
	return keys, nil
}

// tailscaleController adapts tailnet.Manager to the instance module's port.
type tailscaleController struct{ m *tailnet.Manager }

func (c tailscaleController) Apply(s instance.TailscaleSettings) {
	c.m.Apply(tailnet.Settings{
		Enabled: s.Enabled, Hostname: s.Hostname, AuthKey: s.AuthKey,
		ControlURL: s.ControlURL, Funnel: s.Funnel,
	})
}

func (c tailscaleController) Status(ctx context.Context) instance.TailscaleStatus {
	st, on := c.m.Status(ctx)
	return instance.TailscaleStatus{
		Enabled: on, State: st.State, LoginURL: st.LoginURL,
		URL: st.URL, Funnel: st.Funnel, Error: st.Error,
		TailnetIP: st.TailnetIP, CarriesVoice: st.Media,
	}
}

// relayProvider adapts the instance module's reachability settings to
// voice's port.
type relayProvider struct{ instance *instance.Service }

func (p relayProvider) RelaySettings(ctx context.Context) (voice.RelaySettings, error) {
	r, err := p.instance.Reachability(ctx)
	if err != nil {
		return voice.RelaySettings{}, err
	}
	return voice.RelaySettings{
		TURN: voice.StaticTURN{
			URLs: r.TURN.URLs, Username: r.TURN.Username, Credential: r.TURN.Credential,
			STUNURLs: r.TURN.STUNURLs,
		},
		Cloudflare: voice.CloudflareTURN{KeyID: r.Cloudflare.KeyID, APIToken: r.Cloudflare.APIToken},
	}, nil
}

// Run serves until ctx is canceled, then shuts down gracefully. The plain
// listener always runs; the Tailscale one runs alongside it when enabled.
func (a *App) Run(ctx context.Context) error {
	errCh := make(chan error, 2)
	go func() {
		a.log.Info("stoop listening", "addr", a.server.Addr)
		errCh <- a.server.ListenAndServe()
	}()
	// The Tailscale listener starts, stops, and restarts as its settings
	// change; a failure there is logged, never fatal to the plain listener.
	go a.tailnet.Run(ctx)
	// Storage hygiene on a timer (STOOP_FILE_SWEEP_INTERVAL; 0 disables).
	go a.files.RunSweeper(ctx, a.sweep)
	// Read activity items older than STOOP_ACTIVITY_RETENTION go too.
	go a.chat.RunActivitySweeper(ctx, a.sweep, a.keep)

	select {
	case err := <-errCh:
		return fmt.Errorf("serve: %w", err)
	case <-ctx.Done():
	}

	a.log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := a.server.Shutdown(shutdownCtx)
	a.voice.Close()
	a.pool.Close()
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("shutdown: %w", err)
	}
	return nil
}

// Port adapters. Each maps a provider module's exported API onto a consumer
// module's port interface. Extracting a module into its own service later
// means swapping these for Connect clients — nothing else changes.

// displayNames adapts auth's user lookup to voice.UserDirectory.
type displayNames struct{ auth *auth.Service }

func (d displayNames) DisplayName(ctx context.Context, userID string) (string, error) {
	users, err := d.auth.GetPublicUsers(ctx, []string{userID})
	if err != nil {
		return "", err
	}
	if len(users) == 0 {
		return "", fmt.Errorf("user %s not found", userID)
	}
	return users[0].DisplayName, nil
}

type userDirectory struct{ auth *auth.Service }

func (d userDirectory) GetUsers(ctx context.Context, ids []string) ([]chat.UserRecord, error) {
	users, err := d.auth.GetPublicUsers(ctx, ids)
	if err != nil {
		return nil, err
	}
	records := make([]chat.UserRecord, len(users))
	for i, u := range users {
		records[i] = chat.UserRecord{
			ID: u.ID, Username: u.Username, DisplayName: u.DisplayName,
			InstanceAdmin: u.Role == authctx.RoleAdmin, AvatarFileID: u.AvatarFileID,
		}
	}
	return records, nil
}

// userAdmin adapts auth's account administration onto instance's port.
type userAdmin struct{ auth *auth.Service }

func (a userAdmin) CountUsers(ctx context.Context) (int64, error) { return a.auth.CountUsers(ctx) }
func (a userAdmin) CountActiveAdmins(ctx context.Context) (int64, error) {
	return a.auth.CountActiveAdmins(ctx)
}
func (a userAdmin) ListUsers(ctx context.Context) ([]instance.UserSummary, error) {
	accounts, err := a.auth.ListAccounts(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]instance.UserSummary, len(accounts))
	for i, u := range accounts {
		out[i] = toUserSummary(u)
	}
	return out, nil
}
func (a userAdmin) SetUserRole(ctx context.Context, userID string, role authctx.Role) (instance.UserSummary, error) {
	u, err := a.auth.SetAccountRole(ctx, userID, role)
	return toUserSummary(u), err
}
func (a userAdmin) RenameUser(ctx context.Context, userID string, username, displayName *string) (instance.UserSummary, error) {
	u, err := a.auth.RenameAccount(ctx, userID, username, displayName)
	return toUserSummary(u), err
}
func (a userAdmin) SetUsernameFrozen(ctx context.Context, userID string, frozen bool) (instance.UserSummary, error) {
	u, err := a.auth.SetAccountUsernameFrozen(ctx, userID, frozen)
	return toUserSummary(u), err
}
func (a userAdmin) ClearUserProfile(ctx context.Context, userID string, pronouns, bio bool) (instance.UserSummary, error) {
	u, err := a.auth.ClearAccountProfile(ctx, userID, pronouns, bio)
	return toUserSummary(u), err
}
func (a userAdmin) SetUserActive(ctx context.Context, userID string, active bool) (instance.UserSummary, error) {
	u, err := a.auth.SetAccountActive(ctx, userID, active)
	return toUserSummary(u), err
}
func (a userAdmin) ResetUserPassword(ctx context.Context, userID string) (string, instance.UserSummary, error) {
	temp, u, err := a.auth.ResetPassword(ctx, userID)
	return temp, toUserSummary(u), err
}
func toUserSummary(u auth.AccountSummary) instance.UserSummary {
	return instance.UserSummary{
		ID: u.ID, Username: u.Username, DisplayName: u.DisplayName,
		Role: u.Role, CreatedAt: u.CreatedAt, DeactivatedAt: u.DeactivatedAt,
		UsernameFrozen: u.UsernameFrozen, HasPassword: u.HasPassword,
		Pronouns: u.Pronouns, Bio: u.Bio,
	}
}

// fileDirectory adapts the files module onto chat's attachment port.
type fileDirectory struct{ files *files.Service }

func (d fileDirectory) GetFiles(ctx context.Context, ids []string) ([]chat.FileRecord, error) {
	infos, err := d.files.GetFiles(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]chat.FileRecord, len(infos))
	for i, f := range infos {
		out[i] = chat.FileRecord{
			ID: f.ID, Kind: string(f.Kind), OwnerID: f.OwnerID, SpaceID: f.SpaceID,
			Name: f.Name, ContentType: f.ContentType, Size: f.Size,
		}
	}
	return out, nil
}

func (d fileDirectory) DeleteFiles(ctx context.Context, ids []string) error {
	return d.files.DeleteFiles(ctx, ids)
}

// identityVerifier is the same check for handlers that need the whole
// identity (the files download handler consults the instance role).
type identityVerifier struct{ auth *auth.Service }

func (v identityVerifier) VerifyRequest(ctx context.Context, h http.Header) (authctx.Identity, error) {
	return v.auth.VerifyToken(ctx, auth.TokenFromHeader(h))
}

type sessionVerifier struct{ auth *auth.Service }

func (v sessionVerifier) VerifyRequest(ctx context.Context, h http.Header) (string, error) {
	identity, err := v.auth.VerifyToken(ctx, auth.TokenFromHeader(h))
	if err != nil {
		return "", err
	}
	return identity.UserID, nil
}

// unfurler adapts internal/unfurl to chat's port.
type unfurler struct{ f *unfurl.Fetcher }

func (u unfurler) Fetch(ctx context.Context, url string) (chat.LinkMeta, error) {
	p, err := u.f.Fetch(ctx, url)
	if err != nil {
		return chat.LinkMeta{}, err
	}
	return chat.LinkMeta{Title: p.Title, Description: p.Description, SiteName: p.SiteName, Image: p.Image}, nil
}

// providerSource adapts instance's login-provider settings to auth's
// ProviderSource port (auth cannot import instance).
type providerSource struct{ instance *instance.Service }

func (p providerSource) LoginProvider(ctx context.Context, id string) (auth.ProviderConfig, error) {
	lp, err := p.instance.LoginProvider(ctx, id)
	if err != nil {
		return auth.ProviderConfig{}, err
	}
	return auth.ProviderConfig{
		ID: lp.ID, Kind: lp.Kind, DisplayName: lp.DisplayName,
		Issuer: lp.Issuer, ClientID: lp.ClientID, ClientSecret: lp.ClientSecret,
	}, nil
}

func (p providerSource) CallbackURL(ctx context.Context, id string) (string, error) {
	return p.instance.CallbackURL(ctx, id)
}
