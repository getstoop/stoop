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
	"os"
	"path/filepath"
	"sync"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/gen/stoop/auth/v1/authv1connect"
	"github.com/getstoop/stoop/gen/stoop/chat/v1/chatv1connect"
	"github.com/getstoop/stoop/gen/stoop/files/v1/filesv1connect"
	"github.com/getstoop/stoop/gen/stoop/instance/v1/instancev1connect"
	"github.com/getstoop/stoop/gen/stoop/integrations/v1/integrationsv1connect"
	"github.com/getstoop/stoop/gen/stoop/voice/v1/voicev1connect"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/blob"
	"github.com/getstoop/stoop/internal/buildinfo"
	"github.com/getstoop/stoop/internal/cftunnel"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/diag"
	"github.com/getstoop/stoop/internal/eventrelay"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/files"
	"github.com/getstoop/stoop/internal/instance"
	"github.com/getstoop/stoop/internal/integrations"
	"github.com/getstoop/stoop/internal/jobs"
	"github.com/getstoop/stoop/internal/kv"
	"github.com/getstoop/stoop/internal/ratelimit"
	"github.com/getstoop/stoop/internal/realtime"
	"github.com/getstoop/stoop/internal/tailnet"
	"github.com/getstoop/stoop/internal/unfurl"
	"github.com/getstoop/stoop/internal/voice"
	"github.com/getstoop/stoop/internal/webui"
)

// shutdownTimeout is how long Run and Close give the HTTP server to drain
// and the background goroutines to return before the pool closes.
const shutdownTimeout = 10 * time.Second

type App struct {
	server   *http.Server
	tailnet  *tailnet.Manager
	tunnel   *cftunnel.Manager
	hooks    *integrations.Service
	voice    *voice.Service
	jobs     *jobs.Service
	registry *jobs.Registry
	// relay republishes what a `stoop jobs` process publishes.
	relay *eventrelay.Listener
	pool  *pgxpool.Pool
	log   *slog.Logger
	// jobsMode is where the dispatcher runs (STOOP_JOBS).
	jobsMode string
	// wg counts the goroutines spawn started, so shutdown can wait for
	// them before the pool closes.
	wg sync.WaitGroup
}

// modules is what the server and the jobs runner both build: the pool,
// the bus, the stores, every module with its ports wired, and the jobs
// service with its kinds registered and the sweeps scheduled.
type modules struct {
	pool     *pgxpool.Pool
	bus      events.Bus
	store    *blob.FS
	stores   *kv.Memory
	auth     *auth.Service
	instance *instance.Service
	chat     *chat.Service
	files    *files.Service
	hooks    *integrations.Service
	registry *jobs.Registry
	jobs     *jobs.Service
}

// newModules connects and migrates, then constructs the modules in the
// order docs/architecture/modules.md gives, on the bus newBus builds over
// the pool. It closes the pool on failure.
func newModules(ctx context.Context, cfg config.Config, log *slog.Logger, newBus func(*pgxpool.Pool) events.Bus) (_ *modules, err error) {
	pool, err := db.Connect(ctx, cfg.DatabaseURL, cfg.DatabasePoolMax)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			pool.Close()
		}
	}()
	if cfg.DatabasePoolMaxShadowsURL {
		log.Info("STOOP_DATABASE_POOL_MAX overrides pool_max_conns in STOOP_DATABASE_URL", "pool_max", cfg.DatabasePoolMax)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		return nil, err
	}

	bus := newBus(pool)

	// The blob store is the only thing that touches file storage. Only
	// the filesystem backend exists today; config rejects anything else.
	store, err := blob.NewFS(cfg.StorageDir)
	if err != nil {
		return nil, err
	}
	log.Info("file storage", "backend", cfg.Storage, "dir", store.Root())

	// Keyed in-memory state (lockouts, sign-in attempts, rate buckets):
	// one backend, so the Diagnostics tab can count every store.
	stores := kv.NewMemory(nil)
	authSvc := auth.New(pool, auth.Options{
		SecureCookies: cfg.SecureCookies,
		Procedures:    procedures,
		Stores:        stores,
	})
	instanceSvc := instance.New(pool, userAdmin{authSvc})
	if err := instanceSvc.Seed(ctx, instance.Defaults{
		RegistrationPolicy: instance.Policy(cfg.RegistrationPolicy),
		InstanceNameEnv:    cfg.InstanceName,
	}); err != nil {
		return nil, err
	}
	instanceSvc.UseInstanceNameEnv(cfg.InstanceName)
	chatSvc := chat.New(pool, bus, userDirectory{authSvc})
	// auth ↔ instance/chat is the one cyclic pair of ports; it's closed
	// with a setter after both sides exist.
	authSvc.UseRegistrationPorts(instanceSvc, chatSvc)
	authSvc.UseProviders(providerSource{instanceSvc})
	authSvc.UsePasswordPolicy(instanceSvc)
	authSvc.UseTokenPolicy(instanceSvc)
	authSvc.UseSessionPolicy(instanceSvc)
	authSvc.UseDeletionPorts(instanceSvc, chatSvc)
	authSvc.UseBus(bus)
	instanceSvc.UseSessionLifetimeEnv(cfg.SessionLifetimeDays)
	instanceSvc.UseWebhooksEnv(cfg.Webhooks)
	instanceSvc.UseTestEmailThrottle(ratelimit.New(stores, "ratelimit_test_email", 5, 5))
	chatSvc.UseInstancePolicy(instanceSvc)
	chatSvc.UseSearchThrottle(ratelimit.New(stores, "ratelimit_search", cfg.SearchRateLimit, cfg.SearchRateLimit))
	filesSvc := files.New(pool, store, bus, authSvc, chatSvc, identityVerifier{authSvc}, log)
	filesSvc.UsePolicy(instanceSvc)
	instanceSvc.UseUploadCeiling(files.MaxAttachmentBytes)
	filesSvc.UseSweepGrace(cfg.FileSweepGrace)
	chatSvc.UseFiles(fileDirectory{filesSvc})
	instanceSvc.UseRetentionCounter(retentionCounter{chatSvc, filesSvc})
	integrationsSvc := integrations.New(pool, bus, log)
	integrationsSvc.UsePolicy(instanceSvc)
	integrationsSvc.UsePoster(hookPoster{chatSvc})
	integrationsSvc.UseSpaceAccess(chatSvc)
	integrationsSvc.UseBotIdentities(botIdentities{authSvc})
	integrationsSvc.UseHookThrottle(ratelimit.New(stores, "ratelimit_hooks", cfg.WebhookRateLimit, cfg.WebhookRateLimit))
	// The sweeps as scheduled jobs; the Background work panel, the jobs
	// health row and /metrics read their rows through one reader.
	registry := jobs.NewRegistry()
	registerSweeps(registry, cfg, log, authSvc, chatSvc, filesSvc, integrationsSvc)
	registerDeliveries(registry, integrationsSvc, cfg.JobsWorkers)
	registerImages(registry, filesSvc)
	registerEmail(registry, authSvc, instanceSvc)
	jobsSvc := jobs.New(pool, registry, jobs.Config{Workers: cfg.JobsWorkers, Poll: cfg.JobsPoll, Retention: cfg.JobsRetention}, log)
	filesSvc.UseJobs(jobsSvc)
	integrationsSvc.UseJobs(deliveryJobs{jobsSvc})
	authSvc.UseEmailPorts(jobsSvc, instanceSvc.EmailEnabled)
	authSvc.UseEmailThrottle(ratelimit.NewPer(stores, "ratelimit_email_change", 3, time.Hour))
	if err := scheduleSweeps(ctx, jobsSvc, cfg); err != nil {
		return nil, err
	}
	if cfg.LinkPreviews {
		chatSvc.UseUnfurler(unfurler{unfurl.New(unfurl.Options{AllowPrivate: cfg.UnfurlAllowPrivate})}, filesSvc, chat.UnfurlOptions{})
		if cfg.UnfurlAllowPrivate {
			log.Warn("link previews may fetch private addresses (STOOP_UNFURL_ALLOW_PRIVATE); never use this outside development")
		}
	}
	return &modules{
		pool: pool, bus: bus, store: store, stores: stores,
		auth: authSvc, instance: instanceSvc, chat: chatSvc, files: filesSvc, hooks: integrationsSvc,
		registry: registry, jobs: jobsSvc,
	}, nil
}

// New builds the server: the modules, then what only the server runs —
// voice, the gateway, the limiters, the mux, the front doors and the
// Diagnostics tab's readers. It closes the pool on failure.
func New(ctx context.Context, cfg config.Config, log *slog.Logger) (_ *App, err error) {
	// The server's own publishes stay in this process; what a `stoop jobs`
	// publishes arrives through the relay listener StartBackground runs.
	shared, err := newModules(ctx, cfg, log, func(*pgxpool.Pool) events.Bus { return events.NewInProcBus() })
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			shared.pool.Close()
		}
	}()
	pool, bus, store, stores := shared.pool, shared.bus, shared.store, shared.stores
	authSvc, instanceSvc, chatSvc := shared.auth, shared.instance, shared.chat
	filesSvc, integrationsSvc, jobsSvc := shared.files, shared.hooks, shared.jobs

	bi := buildinfo.Get()
	instanceSvc.UseBuildInfo(instance.BuildInfo{Version: bi.Version, Commit: bi.Commit, BuiltAt: bi.Date, GoVersion: bi.GoVersion})
	if cfg.UpdateCheck {
		// A nil pointer in the interface would not read as "off".
		if checker := newUpdateChecker(bi.Version, log); checker != nil {
			instanceSvc.UseUpdateChecker(checker)
		}
	}
	keys, err := livekitKeys(ctx, cfg, instanceSvc, log)
	if err != nil {
		return nil, err
	}
	voiceOpts := voice.Options{
		LiveKitURL:       cfg.LiveKitURL,
		LiveKitAPIKey:    keys.APIKey,
		LiveKitAPISecret: keys.APISecret,
	}
	voiceSvc := voice.New(chatSvc, userDirectory{authSvc}, voiceOpts, log)
	// The other direction: chat ends calls through the SFU.
	chatSvc.UseVoiceRooms(voiceSvc)
	gateway := realtime.NewGateway(bus, identityVerifier{authSvc}, chatSvc, chatSvc, cfg.AllowedWSOrigins, log)
	gateway.UseDoNotDisturb(authSvc)
	chatSvc.UsePresence(gateway)
	jobList := jobReader(jobsSvc)
	instanceSvc.UseJobRecords(jobList)
	// The delivery backlog and log as the Diagnostics tab and a metrics
	// scrape read them, counted only when asked.
	queue := webhookQueue(jobsSvc, integrationsSvc)
	instanceSvc.UseWebhookQueue(queue.stats)

	handler, err := newHandler(cfg, log, shared, voiceSvc, gateway, queue, jobList)
	if err != nil {
		return nil, err
	}
	// After the last store is opened, so every one gets its gauge.
	registerGauges(gateway, stores)

	a := &App{
		server: &http.Server{
			Addr:              cfg.ListenAddr,
			Handler:           handler,
			ReadHeaderTimeout: 10 * time.Second,
		},
		hooks:    integrationsSvc,
		voice:    voiceSvc,
		jobs:     jobsSvc,
		registry: shared.registry,
		relay:    eventrelay.NewListener(bus, pool, log),
		pool:     pool,
		log:      log,
		jobsMode: cfg.Jobs,
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
		nodeIP := newNodeIPWriter(cfg, log)
		a.tailnet.UseAddressHook(nodeIP.set)
	}

	a.tunnel = cftunnel.NewManager(cfg.CloudflaredPath, log)

	UseSettingsEnv(instanceSvc, cfg)
	instanceSvc.UseVoiceConfigured(voiceSvc.Enabled())
	if err := instanceSvc.SeedFromEnv(ctx); err != nil {
		return nil, err
	}
	instanceSvc.UseEnvSet(config.IsSet)
	drifted, err := instanceSvc.EnvDrift(ctx)
	if err != nil {
		return nil, err
	}
	for _, name := range drifted {
		log.Warn("this variable differs from the saved setting, which is the one used; change it under Server admin or with stoop admin setting", "variable", name)
	}
	if err := instanceSvc.LoadTrustedProxies(ctx); err != nil {
		return nil, err
	}
	voiceSvc.UseRelayProvider(relayProvider{instanceSvc})
	instanceSvc.UsePublicURL(a.tailnet.PublicURL)
	// What the Hosting page can say about the voice sidecar: whether it
	// is configured, whether it answers, and what Stoop has handed it.
	livekit := newLiveKitReporter(cfg, voiceOpts)
	instanceSvc.UseLiveKit(livekit)
	// The Diagnostics tab's Health panel, in the order it lists them.
	started := time.Now()
	instanceSvc.UseStartedAt(started)
	instanceSvc.UseHealthChecks(
		newPostgresCheck(pool, started),
		newLiveKitCheck(cfg.Voice, voiceOpts, livekit),
		newStorageCheck(store.Root(), filesSvc),
		instanceSvc.PublicAddressCheck(),
		instanceSvc.EmailCheck(),
		newWebhooksCheck(queue),
		newJobsCheck(jobList),
		newJobsRunnerCheck(jobsSvc.Dispatchers),
	)
	if err := instanceSvc.UseTailscale(ctx, tailscaleController{a.tailnet}); err != nil {
		return nil, err
	}
	if err := instanceSvc.UseCloudflareTunnel(ctx, tunnelController{a.tunnel}); err != nil {
		return nil, err
	}
	return a, nil
}

// newHandler builds the whole HTTP surface: the anonymous-endpoint
// limiters, the Connect services and their interceptors, the plain
// handlers and the web app, behind the transport and security headers.
func newHandler(cfg config.Config, log *slog.Logger, shared *modules, voiceSvc *voice.Service,
	gateway *realtime.Gateway, queue *queueStats, jobList func(context.Context) ([]diag.JobRecord, error)) (http.Handler, error) {
	stores, authSvc, instanceSvc, chatSvc := shared.stores, shared.auth, shared.instance, shared.chat
	filesSvc, integrationsSvc := shared.files, shared.hooks

	// Anonymous-endpoint throttles. Login, Register and the invite lookup
	// are the only Connect procedures worth guessing at; the signaling
	// proxy is the only plain handler without a session check. Both are per client IP, so behind
	// a proxy it must be a trusted proxy or every user shares a bucket.
	authLimiter := ratelimit.New(stores, "ratelimit_auth", cfg.AuthRateLimit, cfg.AuthRateLimit)
	signalingLimiter := ratelimit.New(stores, "ratelimit_signaling", cfg.SignalingRateLimit, cfg.SignalingRateLimit)
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
			// Outermost, so a call refused by auth or the limiter is timed too.
			diag.Interceptor(),
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
	mux.Handle(integrationsv1connect.NewIntegrationServiceHandler(integrationsSvc, interceptors))
	mux.Handle("POST /files/upload", filesSvc.UploadHandler())
	mux.Handle("POST /hooks/{token}", integrationsSvc.HookHandler())
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
	mux.Handle("GET /version", versionHandler())
	mux.Handle("GET /metrics", metricsHandler(authSvc, instanceSvc, queue, jobList, log))
	web, scripts := webui.Handler(), webui.ScriptHashes()
	if cfg.DevWebURL != "" {
		if web, err = webui.DevProxy(cfg.DevWebURL); err != nil {
			return nil, fmt.Errorf("STOOP_DEV_WEB_URL: %w", err)
		}
		// Vite adds inline scripts of its own (the React refresh preamble),
		// and a browser ignores 'unsafe-inline' next to a hash list.
		scripts = []string{"'unsafe-inline'"}
		log.Warn("serving the web app from the Vite dev server (STOOP_DEV_WEB_URL); never use this outside development", "url", cfg.DevWebURL)
	}
	// Two client routes under a prefix the /auth/ mux above owns, which
	// would otherwise answer them 404: where the browser is sent to fire
	// the deep link, and where the app lands when it comes back.
	mux.Handle("GET /auth/desktop/return", web)
	mux.Handle("GET /auth/desktop/complete", web)
	mux.Handle("/", web)
	// secureTransport is outermost: the headers below it read the TLS
	// verdict it puts on the context.
	return secureTransport(securityHeaders(mux, scripts), instanceSvc.TrustsPeer), nil
}

// Handler is the whole HTTP surface, for a test that serves the binary
// in-process.
func (a *App) Handler() http.Handler { return a.server.Handler }

// Close waits up to shutdownTimeout for the background goroutines and
// releases the database pool; Run does this itself on shutdown.
func (a *App) Close() {
	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	a.waitBackground(ctx)
	a.pool.Close()
}

// waitBackground waits for the goroutines spawn started until ctx ends.
func (a *App) waitBackground(ctx context.Context) {
	done := make(chan struct{})
	go func() {
		a.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
		a.log.Warn("background work still running at shutdown")
	}
}

// spawn runs fn on a goroutine Close and Run wait for.
func (a *App) spawn(fn func()) {
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		fn()
	}()
}

// StartBackground launches everything that runs beside the plain
// listener: the job dispatcher (or the child that runs it), the relay
// listener, the outgoing-webhook subscriber, the two front-door managers
// and the sampler. Run calls it; a test that serves the handler itself
// calls it too, so deliveries happen.
func (a *App) StartBackground(ctx context.Context) {
	a.startDispatcher(ctx)
	// Events a `stoop jobs` process publishes, in every mode: one may run
	// beside this server whatever STOOP_JOBS says.
	a.spawn(func() { a.relay.Run(ctx) })
	// The outgoing pipeline's producer: bus in, delivery jobs out; the
	// POSTs run on the dispatcher.
	a.spawn(func() { a.hooks.RunSubscriber(ctx) })
	// The Tailscale node and cloudflared start, stop and restart as their
	// settings change; a failure there is logged, never fatal to the plain
	// listener.
	a.spawn(func() { a.tailnet.Run(ctx) })
	a.spawn(func() { a.tunnel.Run(ctx) })
	// The Diagnostics tab's gauge ring and per-minute request windows.
	a.spawn(func() { diag.RunSampler(ctx, diag.Default, diag.RPC) })
}

// startDispatcher runs the sweeps, the deliveries and anything else
// queued where STOOP_JOBS says: in this process, in a `stoop jobs` child
// it supervises, or nowhere in it (external).
func (a *App) startDispatcher(ctx context.Context) {
	switch a.jobsMode {
	case config.JobsExternal:
		a.log.Info("background jobs run in a separate stoop jobs process (STOOP_JOBS=external)")
		return
	case config.JobsChild:
		path, err := os.Executable()
		if err != nil {
			a.log.Error("background jobs run in this process: could not find the binary to start a child (STOOP_JOBS=child)", "err", err)
			break
		}
		a.log.Info("background jobs run in a supervised stoop jobs child (STOOP_JOBS=child)", "path", path)
		a.spawn(func() { newJobsChild(path, []string{"jobs"}, a.log).Run(ctx) })
		return
	}
	a.spawn(func() { a.jobs.RunDispatcher(ctx) })
}

// Run serves until ctx ends or the listener fails, then shuts down: the
// HTTP server drains and the background work, voice included, returns
// within shutdownTimeout, then the pool closes.
func (a *App) Run(ctx context.Context) error {
	runCtx, stop := context.WithCancel(ctx)
	defer stop()
	served := make(chan error, 1)
	go func() {
		a.log.Info("stoop listening", "addr", a.server.Addr)
		served <- a.server.ListenAndServe()
		stop()
	}()
	a.StartBackground(runCtx)
	// Voice's room-close repeats stop with the rest, inside the budget.
	a.spawn(func() {
		<-runCtx.Done()
		a.voice.Close()
	})
	<-runCtx.Done()

	a.log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	shutdownErr := a.server.Shutdown(shutdownCtx)
	a.waitBackground(shutdownCtx)
	a.pool.Close()
	// Shutdown makes ListenAndServe return at once, so this never blocks.
	if serveErr := <-served; !errors.Is(serveErr, http.ErrServerClosed) {
		return fmt.Errorf("serve: %w", serveErr)
	}
	if shutdownErr != nil {
		return fmt.Errorf("shutdown: %w", shutdownErr)
	}
	return nil
}
