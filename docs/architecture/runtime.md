# Runtime: process, configuration, and delivery

This document covers what the running system *is* on a machine: the
process, how it is configured, how the world reaches it, what protects it,
and how a build gets made.

The operator's how-to is [../self-hosting.md](../self-hosting.md). This is
the model behind it.

## The process

One process, one binary, two possible listeners.

```
stoop
├── HTTP listener on STOOP_LISTEN_ADDR          always
├── HTTPS listener on the tailnet (tsnet)       when Tailscale is enabled
├── goroutine: tailnet manager                  reconciles the node with saved settings
├── goroutine: file sweep                       STOOP_FILE_SWEEP_INTERVAL
└── goroutine: activity sweep                   same timer
```

`cmd/stoop/main.go` is about thirty lines: dispatch the `admin` subcommand,
load config, install a signal-cancelled context (`SIGINT`, `SIGTERM`),
build the app, run it. Everything else is `internal/app`
([modules.md](modules.md#rule-5--internalapp-is-the-only-all-knowing-package)).

**Startup order matters and is fixed:** connect to Postgres, run
migrations, *then* construct anything. A server that started on an
unmigrated schema would fail later and less legibly than one that refuses
to start.

**Shutdown** cancels the context, gives the HTTP server ten seconds to
drain, and closes the pool. Failures on the Tailscale listener are logged
and never fatal to the plain one: an optional front door must not be able
to take down the baseline.

**Migrations run automatically at startup**, which is what makes upgrading
"pull the new binary and restart". There is no separate migration step for
an operator to forget, and no window where a new binary runs against an old
schema.

`GET /healthz` answers `200 ok` for container health checks and for the E2E
harness's readiness loop. Logging is `log/slog` to stderr, structured, with
no log file to rotate — the supervisor that runs the process already has
one.

## Configuration: two tiers

Stoop has two kinds of configuration, and knowing which is which explains
most of its behaviour.

**Environment variables (`STOOP_*`)** are for things that are true of the
*deployment*: where the database is, what address to bind, where the
storage directory lives, where LiveKit is. `internal/config` reads them
once at startup and validates them; an invalid value is a fatal error, not
a silent fallback. `STOOP_STORAGE=s3` is rejected today rather than
quietly writing to local disk, because a silent fallback is how people lose
files.

**Instance settings (`instance_settings`)** are for things the *operator*
decides and may change at runtime: the registration policy, quotas, login
providers, how the server is reached. They live in Postgres and are edited
from `/admin`.

The two tiers meet by one of two rules, and which rule applies is
deliberate:

| Rule | Applies to | Behaviour |
| ---- | ---------- | --------- |
| **Seed once** | `STOOP_REGISTRATION` | The environment sets the value on first boot only. After that the database is the source of truth, and changing the variable does nothing. |
| **Env fallback** | `STOOP_PASSWORD_SIGN_IN`, `STOOP_INSTANCE_NAME`, reachability, login providers | A saved value overrides the environment; *clearing* a saved value falls back to the environment. Nothing is seeded. (`STOOP_INSTANCE_NAME` is the one exception: when it is *unset*, first boot seeds a random name so the tab never just says "Stoop"; when set, it is a plain fallback like the others.) |

The second rule exists so that `.env` stays live for people who never open
the admin page. An operator who configured everything in Docker Compose and
never touched the UI keeps working exactly as before; an operator who saves
something on the Hosting page takes ownership of that field and can hand it
back by clearing it.

**Secrets are write-only in the API.** `GetReachability` and
`GetLoginProviders` never return a client secret or a TURN credential;
saving with a blank secret keeps the stored one, as long as the identifier
beside it is unchanged.

**Every field of `UpdateReachability` is optional, and an unset field is
left exactly as found.** The admin form leans on this: it keeps a baseline
of what the server last reported and sends only the groups that differ, so
one Save button can cover the whole page without a change to the address
disturbing a relay.

### The environment surface

The full reference with defaults is in
[../self-hosting.md](../self-hosting.md#configuration-reference). Grouped by
what they are for:

- **Core** — `STOOP_DATABASE_URL` (required), `STOOP_LISTEN_ADDR`,
  `STOOP_PUBLIC_URL`, `STOOP_STORAGE`, `STOOP_STORAGE_DIR`.
- **Trust and TLS** — `STOOP_TRUST_PROXY`, `STOOP_SECURE_COOKIES`,
  `STOOP_ALLOWED_WS_ORIGINS`.
- **Abuse** — `STOOP_AUTH_RATE_LIMIT`, `STOOP_SIGNALING_RATE_LIMIT`.
- **Policy** — `STOOP_REGISTRATION` (seeded once), `STOOP_PASSWORD_SIGN_IN`
  (fallback), `STOOP_INSTANCE_NAME` (fallback; random when unset).
- **Voice** — `STOOP_LIVEKIT_URL`, `STOOP_LIVEKIT_API_KEY` / `_SECRET`,
  `STOOP_LIVEKIT_KEY_FILE`, `STOOP_LIVEKIT_NODE_IP_FILE`,
  `STOOP_LIVEKIT_MEDIA_HOST`, `STOOP_LIVEKIT_TCP_PORT`,
  `STOOP_LIVEKIT_UDP_PORTS`.
- **Relays** — `STOOP_TURN_URLS` / `_USERNAME` / `_CREDENTIAL`,
  `STOOP_STUN_URLS`, `STOOP_CLOUDFLARE_TURN_KEY_ID` / `_API_TOKEN`.
- **Tailscale** — `STOOP_TAILSCALE`, `_HOSTNAME`, `_AUTHKEY`,
  `_CONTROL_URL`, `_FUNNEL`, `_VOICE`.
- **Housekeeping** — `STOOP_FILE_SWEEP_INTERVAL`, `STOOP_FILE_SWEEP_GRACE`,
  `STOOP_ACTIVITY_RETENTION`, `STOOP_LINK_PREVIEWS`,
  `STOOP_UNFURL_ALLOW_PRIVATE`.

Two are dangerous enough to be logged loudly at startup:
`STOOP_UNFURL_ALLOW_PRIVATE` (which turns the server into a probe of the
operator's LAN) and a disabled rate limit ("fine for dev, not for a
reachable server").

## Front doors

**Stoop serves one plain HTTP listener and stays agnostic about what sits
in front of it.** This is a deliberate refusal to grow a TLS terminator, a
certificate manager, and an ACME client, all of which the operator's
existing reverse proxy already has.

| Option | Carries the app | Carries voice media |
| ------ | :-------------: | :-----------------: |
| A reverse proxy you already run (Caddy, nginx, Traefik) | yes | only if LiveKit's media ports are also reachable |
| Cloudflare Tunnel | yes | **no** — needs TURN |
| Tailscale, built in | yes | yes, when `STOOP_TAILSCALE_VOICE` is on |
| Tailscale Funnel | yes | **no** — needs TURN |
| A LAN without HTTPS | yes | yes |

**The one consequence every front door shares:** it carries chat and voice
*signaling*, never voice *audio*. See [voice.md](voice.md).

### Trusted proxies

`internal/trustedproxy` holds addresses or CIDR ranges whose forwarded
headers may be believed. It is saved like any other reachability setting
but is **deliberately independent of the way in** — an internal proxy can
sit in front of a tunnel, a tailnet, or nothing at all.

Three places ask "may this peer's headers be believed?": the auth
rate-limit interceptor, the signaling middleware, and `secureTransport`.
All three call `instance.Service.TrustsPeer`, which reads an
`atomic.Pointer` cache refreshed at startup and on every save — so a change
applies to the next request with no restart and **no database read on the
hot path**.

`STOOP_TRUST_PROXY=true` maps to the legacy trust-everyone set, and is the
fallback when no addresses are saved.

Why this matters twice over: `X-Forwarded-For` from an untrusted peer would
let a caller mint a fresh rate-limit bucket per made-up address, and
`X-Forwarded-Proto: https` from an untrusted peer would let them decide
whether their own session cookie is `Secure`.

### The embedded Tailscale node

`internal/tailnet` runs tsnet in userspace, serving **the same handler** as
the plain listener over HTTPS on the tailnet address, with real
certificates and no third party in the path.

`tailnet.Manager` owns at most one running node and *reconciles* it with
the settings in force: start, stop, restart on a hostname or Funnel change.
The node identity lives in the state directory, so a restart keeps the same
device rather than accumulating machines in the tailnet.

When `STOOP_TAILSCALE_VOICE` is on and LiveKit is configured, the node also
carries **LiveKit's media ports** and relays them to the host — so voice
rides the tailnet with nothing installed on the server. Carrying the ports
is only half of it: LiveKit must also advertise the node's address to
browsers, and it reads that only at startup, so Stoop writes the address to
`STOOP_LIVEKIT_NODE_IP_FILE` where a sidecar started with
`NODE_IP="$(cat …)"` picks it up.

Because a TLS listener and a plain one then coexist in one process, **the
session cookie's `Secure` flag is decided per request** rather than per
deployment — see [identity.md](identity.md#sessions).

## Security headers

One middleware pair wraps the whole mux. `secureTransport` is outermost and
records the TLS verdict on the context; `securityHeaders` reads it. That
order is load-bearing: **HSTS is only promised on a request that actually
arrived over HTTPS**, so a plain-HTTP LAN deployment does not pin browsers
to a scheme it cannot serve.

| Header | Value |
| ------ | ----- |
| `Content-Security-Policy` | See below. |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` (the pre-CSP form of `frame-ancestors`) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(self), microphone=(self), display-capture=(self)`, everything else denied |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Strict-Transport-Security` | `max-age=31536000`, **only over TLS** |

HSTS is a year without `includeSubDomains`, because Stoop is usually one
name among several on an operator's domain and pinning their whole domain
would be presumptuous.

### The CSP

```
default-src 'self'; base-uri 'self'; object-src 'none';
frame-ancestors 'none'; form-action 'self';
script-src 'self' <hash of index.html's one inline script>;
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
media-src 'self' blob:; font-src 'self';
connect-src 'self' ws://<host> wss://<host>;
worker-src 'self' blob:; manifest-src 'self'
```

Everything the app loads, it serves itself. Each remaining looseness has a
reason:

- **`script-src` names a hash, not `'unsafe-inline'`.** `index.html` has
  exactly one inline script — the theme stamp that must run before anything
  paints — and `webui.ScriptHashes()` computes its SHA-256 at startup from
  the embedded build. Hashing that one script is what lets the policy
  refuse every *other* inline script.
- **`connect-src` names the host explicitly** in both WebSocket schemes.
  `'self'` covers them in a current browser; older Safari needs the origin
  spelled out in the scheme the socket uses. The host is validated
  character by character before it goes into a header — it grants nothing
  new, being the origin the browser already reached, but a stray space
  would let a caller append directives.
- **`style-src 'unsafe-inline'`** remains because React writes inline
  styles for measured layout (the voice stage's computed tile width).
- **`img-src data: blob:`** and **`media-src blob:`** are for local
  previews before an upload and for LiveKit's media streams.

## Background work

Two sweepers, both on `STOOP_FILE_SWEEP_INTERVAL` (default 6 h; 0 disables
the timer), both running once shortly after boot — one minute for files,
two for activity — rather than at boot, so a restart loop never turns
into a scan loop:

- **The file sweep** removes uploads nothing points at, and blobs no row
  names. See [files.md](files.md#the-sweep).
- **The activity sweep** removes *read* activity items older than
  `STOOP_ACTIVITY_RETENTION` (default 30 days). Unread ones stay
  however old: nothing someone hasn't seen is taken from them.

Neither is required for correctness. A server that never sweeps works; it
just accumulates.

## The admin CLI

`stoop admin` runs and exits, talking to `STOOP_DATABASE_URL` directly
while the server keeps running:

```
list                              every account and its instance role
promote <username>                make an account an instance admin
demote <username>
reset-password <username>         temporary password, printed once, sessions revoked
password-login <everyone|admins|off>
```

This exists for exactly one situation: the admin page is what you cannot
reach. `password-login everyone` is the break-glass when an identity
provider is down.

## Build and release

```
make generate   buf lint, buf generate, sqlc generate   (output committed)
make build-web  vite build → internal/webui/dist
make build      CGO_ENABLED=0 go build → bin/stoop      (SPA embedded)
make lint       golangci-lint (incl. boundaries) + biome + tsc + theme/style checks
make test       go test ./...
make e2e        the browser suite (wipes the dev database — never without a go-ahead)
```

`CGO_ENABLED=0` is not incidental. Pure-Go static builds for linux/amd64
and linux/arm64 are what make "a Pi is a first-class host" true, and what
make the release artefact a single file with no runtime dependencies.

**Rebuild after any web change** — the binary embeds `web/dist`, so a
Go-only rebuild ships the previous front end. This has cost real sessions
real time and is listed among the traps in
[../agent-workflow.md](../agent-workflow.md).

### CI

Six required jobs, and each protects a specific claim:

| Job | Protects |
| --- | -------- |
| **Protobuf** | `buf lint`, and that the committed `gen/` and `web/src/gen/` match the protos. |
| **Go** | That `internal/dbgen` matches the queries; golangci-lint including the module boundary rules; `go test ./...` against a real Postgres. |
| **Web** | biome, `tsc -b`, and that the SPA builds. |
| **Browser E2E** | The full puppeteer suite against a built binary and its own throwaway Postgres. |
| **Cross-compile (amd64)** | The release target. |
| **Cross-compile (arm64)** | That "runs on a Raspberry Pi" stays honest on every PR. |

A new push to a branch or PR cancels the run still going for the head it
replaced — that result would never be looked at. **Runs on `main` are never
cancelled**: each merge gets its own verdict, and a cancelled one would
look like a red `main`.

### How a change lands

`main` is protected by a repository ruleset: no direct pushes, no
force-pushes, and a pull request merges only once all six jobs are green.
Branch, commit, `gh pr create`, then `gh pr merge --squash --auto`. The
full procedure is in
[../agent-workflow.md](../agent-workflow.md#how-a-change-lands).

### Development

```
make dev   Postgres in Docker + LiveKit on the host network
           + the Go server with hot reload + the Vite dev server
           → http://localhost:5173, proxying the API, /ws and /livekit to :8091
```

`make dev-reset` wipes the dev database and seeds a fixed cast across two
spaces. Note the ordering rule: the E2E runner also wipes the database, so
`dev-reset` runs *after* a suite, not before.
