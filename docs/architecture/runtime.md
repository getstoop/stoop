# Runtime: process, configuration, and delivery

This document covers what the running system *is* on a machine: the
process, how it is configured, how the world reaches it, what protects it,
and how a build gets made.

The operator's how-to is [../self-hosting/](../self-hosting/README.md). This is
the model behind it.

## The process

One process, one binary, two possible listeners.

```
stoop
├── HTTP listener on STOOP_LISTEN_ADDR          always
├── HTTPS listener on the tailnet (tsnet)       when Tailscale is enabled
├── goroutine: tailnet manager                  reconciles the node with saved settings
├── goroutine: tunnel manager                   reconciles cloudflared with saved settings
│   └── child process: cloudflared              when a Cloudflare Tunnel is enabled
├── goroutine: jobs dispatcher                  the schedules and the queue, in Postgres;
│   └── STOOP_JOBS_WORKERS worker goroutines    or a `stoop jobs` process (STOOP_JOBS)
│       └── child process: stoop jobs           when STOOP_JOBS=child
├── goroutine: events relay listener            what a `stoop jobs` publishes, onto the bus
└── goroutine: webhook subscriber               bus events in, fan-out jobs out
```

`cmd/stoop/main.go` is short: dispatch the `admin` subcommand,
load config, install a signal-cancelled context (`SIGINT`, `SIGTERM`),
build the app, run it. Everything else is `internal/app`
([modules.md](modules.md#rule-5--internalapp-is-the-only-all-knowing-package)).

**Startup order matters and is fixed:** connect to Postgres, run
migrations, *then* construct anything. A server that started on an
unmigrated schema would fail later and less legibly than one that refuses
to start.

**Shutdown** cancels the context and gives the HTTP server and `App`'s
wait group ten seconds together: the server drains, and the dispatcher
(which stops leasing, gives in-flight jobs five seconds and clears the
lease on any still running, so they are retried on the next start), the
webhook subscriber, the sampler, cloudflared and the Tailscale node
return. What
is still running when the ten seconds end is logged, and the pool closes
either way. A listener that fails to start takes the same path and
returns its error. `deploy/docker-compose.yml` sets
`stop_grace_period: 15s` so a container stop waits for it. Failures on
the Tailscale listener are logged and never fatal to the plain one: an
optional front door must not be able to take down the baseline.

**Migrations run automatically at startup**, which is what makes upgrading
"pull the new binary and restart". There is no separate migration step for
an operator to forget, and no window where a new binary runs against an old
schema. The run holds a Postgres advisory lock, so a server and a `stoop
jobs` starting together apply each migration once.

`GET /healthz` answers `200 ok` for container health checks and for the E2E
harness's readiness loop. `GET /version` answers
`{"name":"stoop","version":"0.4.0","bridge":2}`
to anyone, so a client can tell what it is talking to before logging in —
the desktop shell refuses a server older than it supports and reads the
`window.stoop` level the served web app speaks ([desktop.md](desktop.md)).
`GET /metrics` is the
Prometheus view of the same instruments the Diagnostics tab reads, behind a
personal token ([diagnostics.md](diagnostics.md)). Logging is `log/slog` to stderr, structured, with
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

The two tiers meet by one rule: **the environment seeds, the database
decides.** It covers `STOOP_REGISTRATION`, `STOOP_INSTANCE_NAME`,
`STOOP_PASSWORD_SIGN_IN`, every reachability group (public URL, trusted
proxies, TURN, Cloudflare TURN, Tailscale, Cloudflare tunnel) and the
`STOOP_OIDC_*` login provider.

- At every start, a setting with no row in `instance_settings` is copied
  from the environment if the environment sets it
  (`instance.SeedFromEnv`, and `Seed` for the registration policy and
  name). An unset `STOOP_INSTANCE_NAME` seeds a random name.
- Once a row exists, it is the setting. Changing the variable does
  nothing, and `EnvDrift` names each variable that differs so the start
  logs a warning.
- Clearing a value on the admin page saves an empty row, never deletes
  one, so a cleared or switched-off setting stays that way across
  restarts.
- A setting is read from the environment directly only while it has no
  row, which happens when the database is wiped under a running server.

**Secrets are write-only in the API.** `GetReachability` and
`GetLoginProviders` never return a client secret or a TURN credential;
saving with a blank secret keeps the one in force. A Cloudflare TURN
token or a provider's client secret is kept only while the key id or
client id beside it is unchanged.

**A refused save writes nothing.** `UpdateSettings` and
`UpdateReachability` validate every field first, then write them in one
transaction, then apply side effects (the Tailscale node, the tunnel,
the trusted-proxy cache).

**Every field of `UpdateReachability` is optional, and an unset field is
left exactly as found.** The admin form leans on this: it keeps a baseline
of what the server last reported and sends only the groups that differ, so
one Save button can cover the whole page without a change to the address
disturbing a relay.

### The environment surface

The full reference with defaults is in
[../self-hosting/configuration.md](../self-hosting/configuration.md).

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
| Cloudflare Tunnel, built in or your own `cloudflared` | yes | **no** — needs TURN |
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

`STOOP_TRUSTED_PROXIES` seeds the list; a saved empty list trusts nothing.

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
A node that stops while still wanted is started again with backoff
(`restart.Loop`), and reports no address until it is back.
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

### The Cloudflare Tunnel connector

`internal/cftunnel` runs `cloudflared` as a **child process**, for a
remotely managed tunnel whose token the operator pastes on the Hosting
page. `cftunnel.Manager` reconciles like `tailnet.Manager`: start, stop,
restart on a new token. The connector restarts a process that exits, with
backoff up to 30 seconds, and stops it with `SIGTERM` and a one-second
grace period (cloudflared's default is 30 seconds, and it holds every
client's WebSocket open for that long). The token reaches cloudflared
through its environment, never its arguments.

State comes from cloudflared's own metrics endpoint, which Stoop binds to a
free loopback port: `/ready` says whether the tunnel is connected. Which
public hostname the tunnel serves is **not** read from it: cloudflared's
`/config` would say, but it is a debugging dump with no promised shape,
and which of its rules is this server is a guess from inside the process.
The operator fills in Public address, as with any other proxy.

cloudflared calls the plain listener over loopback. **Nothing trusts it
implicitly:** the web form writes `127.0.0.1` and `::1` into the Trusted
proxies field when the box is ticked (`localhost` may resolve to either),
and the list stays the one source of trust.

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

`internal/jobs` is a module ([modules.md](modules.md)) with three tables.
`jobs` is the queue and the history: one row per job, `queued`,
`running`, `succeeded` or `discarded`, with the attempt count and the
latest attempt's timing, error and counters. `job_schedules` is one row
per periodic kind: its interval, whether it is enabled and when it is
next due; the dispatcher inserts a `jobs` row when that passes. A new
schedule row is due two minutes after it is created; an existing one
keeps its `next_due` across a restart, moved earlier only when a
shortened interval would pass first; one whose kind this build no longer
registers is disabled when it falls due. `job_dispatchers` is a heartbeat
row per dispatcher.

The seven scheduled kinds, registered and scheduled in `internal/app`
except the last, which the module owns:

| Kind | Every | Removes |
| --- | --- | --- |
| `sweep_files` | `STOOP_FILE_SWEEP_INTERVAL` | uploads nothing points at and blobs no row names ([files.md](files.md#the-sweep)) |
| `sweep_activity` | `STOOP_FILE_SWEEP_INTERVAL`; off when `STOOP_ACTIVITY_RETENTION` is `0` | *read* activity items older than `STOOP_ACTIVITY_RETENTION`, never unread ones ([messaging.md](messaging.md#retention)) |
| `sweep_credentials` | `STOOP_FILE_SWEEP_INTERVAL` | expired sessions at once, expired personal tokens a month after expiry |
| `sweep_hooks` | `STOOP_FILE_SWEEP_INTERVAL` | hook credentials whose hook a channel or space delete cascaded away, bots left with nothing, finished deliveries older than `STOOP_WEBHOOK_DELIVERY_RETENTION`; also finishes deliveries whose job is discarded or gone as dead |
| `sweep_messages` | hourly | messages past `message_retention_days` ([messaging.md](messaging.md#message-retention)) |
| `sweep_attachments` | hourly | attachments past `attachment_retention_days` ([files.md](files.md#retention)) |
| `sweep_jobs` | hourly | finished `jobs` rows older than `STOOP_JOBS_RETENTION`, and dispatcher rows not seen for an hour |

Three one-shot kinds. `fan_out_webhook_event` is queued by the
integrations module per event a hook wants, and queues a
`deliver_webhook` per outgoing delivery
([integrations.md](integrations.md#outgoing)).
`normalise_image` is queued by the files module per avatar, bot avatar or
space icon upload and re-encodes the picture off the request
([files.md](files.md#images)); it is capped at one running at a time.
All three use a lane: a job with `lane` and `sequence` set runs only when no
earlier unfinished job shares its lane, so one runs per lane at a time,
in sequence order, and a retry waiting on its backoff holds the lane. A
hook is a lane, and so is a space for its fan-outs; so is one user's
avatar or one space's icon, so uploads
apply in the order the server received them. Sweeps have no lane. A
laned job's finish wakes the dispatcher, so a lane drains at the pace
of its work, not one head per poll.

A kind registered with `Options{MaxInFlight: n}` never has more than
`n` rows on a live lease (`running`, `leased_until` in the future) across
every dispatcher; `0`, the default, is no cap. A capped kind is leased
in its own transaction under a per-kind advisory lock, with a LIMIT of
the cap less the live leases, so one batch cannot overshoot; a kind at
its cap holds back nothing else. Capped kinds are leased first, so a
stream of uncapped work cannot starve them; the uncapped kinds then
share one query for the slots left. A capped job's finish wakes the
dispatcher, since nothing else announces the freed slot.

The dispatcher (`RunDispatcher`) is woken by the `NOTIFY` the insert of
a job raises, on a connection of its own outside the pool, and polls for
due rows every `STOOP_JOBS_POLL` as the backstop; it leases them with
`FOR UPDATE SKIP LOCKED` to `STOOP_JOBS_WORKERS` goroutines, never a row
it is itself still performing. `running` means the lease (10 minutes by
default, renewed while the performer runs; a performer may extend it) is
in the future, so a row whose lease has lapsed is claimed again as a new
attempt. A
failed attempt, a panic included, goes back to `queued` at the kind's
backoff ladder's time (5 s, 30 s, 2 min; four attempts by default) and
is then `discarded`; only the latest attempt's error and timing are
kept. On shutdown it stops leasing, gives in-flight jobs five seconds,
and clears the lease on anything still running without counting the
attempt, so the next start retries it; the clearing and the wait for
the cancelled workers are bounded too, so it is back under ten seconds
whatever a performer does. The heartbeat row, upserted on every pass and
every 15 s between them, is what shows a dispatcher is alive, and a row
that has gone missing is back on the next beat; it drives
the `jobs_runner` health row
([diagnostics.md](diagnostics.md#the-health-check-port)).

| Variable | Default | Meaning |
| --- | --- | --- |
| `STOOP_JOBS_WORKERS` | `4` | Jobs run at once. |
| `STOOP_JOBS_POLL` | `2s` | How often due rows are looked for when no insert has woken the dispatcher. |
| `STOOP_JOBS_RETENTION` | `168h` | How long finished rows are kept; `0` keeps them forever. |
| `STOOP_FILE_SWEEP_INTERVAL` | `6h` | `0` disables the four schedules on it; the Storage tab can still queue a file sweep. |
| `STOOP_JOBS` | `embedded` | Where the dispatcher runs: in the server, in a `stoop jobs` the server starts and supervises (`child`, restarted with backoff like cloudflared; on Linux it is sent `SIGTERM` when the server dies, however it dies), or in none of it (`external`, the `jobs` compose service or a bare `stoop jobs`). Events a job publishes in either separate process reach the server over Postgres `NOTIFY` ([realtime.md](realtime.md#across-processes)). |

The Storage tab's **Clean now** is `FileService.SweepFiles`: it enqueues
one `sweep_files` job and returns its id, and the Diagnostics tab's
Background work panel shows the pass ([diagnostics.md](diagnostics.md)).

None is required for correctness. A server that never sweeps works; it
just accumulates.

Why it is shaped this way. The queue is Stoop's own, not a library: the
lease pattern was proven by the webhook queue before it, and the feature
list (schedules, lanes, caps, retries) is small and fixed; a need past
that is the moment to adopt a library, not to extend this one. The runner
holds nothing it cannot rebuild from the tables, so it runs in the server
or as `stoop jobs` unchanged; the in-process server is the default, and a
second process is the operator's choice, never the default install. An
attempt's outcome is `Perform`'s return value, written by the dispatcher,
so a performer cannot forget to report and nothing is left `running`. The
poller is the dispatcher; the process minder that runs the child is the
supervisor.

One more goroutine runs for outgoing webhooks
([integrations.md](integrations.md#outgoing)): the subscriber, which turns
bus events into `fan_out_webhook_event` jobs. It stops with the process; the
jobs are in Postgres, so nothing in flight is lost across a restart.

Only the dispatcher moves out under `STOOP_JOBS`. The subscriber, the
sampler and the front-door managers stay in the server in every mode;
`stoop jobs` builds the modules and runs the dispatcher and nothing else.
Its bus relays every publish to the server's over Postgres `NOTIFY`
([realtime.md](realtime.md#across-processes)), and the server holds one
connection outside the pool to hear it, so an avatar a job finished or a
session the credential sweep expired reaches the gateway and the webhook
subscriber as if the job had run in the server.

### The update check

`GetUpdate` reads `https://getstoop.org/releases.json` and compares the
running version with two values in it (`internal/app/update_check.go`):

| Field | Meaning | What an admin sees |
| --- | --- | --- |
| `latest` | The newest release. | A row in Server admin → About when it is newer. |
| `supported` | The oldest release still supported, set by hand on the website. | Below it: a warning at the top of Server admin and a dot on its entry in the rail. |

- **Asked, not scheduled.** The index is read when an admin opens the app
  and the last answer is older than 6 hours; a failed read keeps the last
  answer and is retried after 15 minutes. A server no admin opens makes
  no request.
- **Nothing is sent** but a `User-Agent` of `stoop`: no version, no
  address of the instance.
- **Only a release checks.** A local build has no version to compare.
- **Both values must look like a version** (`1.2.3`) or the read counts
  as failed; the page builds its link from `latest` and nothing else in
  the file. An index with no `supported` calls nothing outdated.
- **Members see neither notice.**
- `STOOP_UPDATE_CHECK=false` turns it off; `GetUpdate` then answers empty.

The server never updates itself; both notices name `stoop upgrade`.

## The admin CLI

`stoop admin` runs and exits, talking to `STOOP_DATABASE_URL` directly
while the server keeps running:

```
list                              every account and its instance role
promote <username>                make an account an instance admin
demote <username>
reset-password <username>         temporary password, printed once, sessions revoked
transfer-owner <username>         make an active admin the server owner
password-login <everyone|admins|off>
setting list|set|clear|reset      the settings the environment seeds
```

This exists for exactly one situation: the admin page is what you cannot
reach. `password-login everyone` is the break-glass when an identity
provider is down; `setting` is the way back from a bad public URL, tunnel
token or provider list, since editing `.env` no longer changes a saved
setting. `setting` saves through the same `Save…` methods as the admin
page, so it refuses what the page refuses. Tailscale, the tunnel and the
trusted-proxy cache are applied at start, so a change to those needs a
restart.

It never migrates. A newer binary would change the schema under the
running server, without the backup `stoop upgrade` takes, so it refuses
with exit status 3 when migrations are pending, or when the schema floor
is past this binary (the same refusal as startup).

`stoop migrate` is the same binary looking at the schema, for the moment
before an upgrade ([data.md](data.md#upgrades-and-rollback)):

```
status    what the database has, what this binary carries, what is pending
plan      status, plus what up means for rolling back; exit 2 with
          something to run, 3 when this binary is too old for the database
up        apply the pending migrations and exit; what startup does
```

`status` and `plan` change nothing. `db.Inspect` builds the answer from
`goose_db_version`, `schema_floor`, the embedded files, `db.Floor` and
`db.Releases`, so `plan` run from the release about to be installed says
whether the release that made the database can still start against it
afterwards; `--json` emits the same `db.Report` for a program.

`stoop upgrade` is the host side of that (`internal/upgrade`): run from
a compose install directory, it fetches the target release's compose
file, runs the new image's `migrate plan --json` against the live
database, takes the runbook backup, swaps the compose file keeping the
old one as `.prev`, starts with a wait, and checks the running version.
`rollback` asks the running image's `migrate status --json` which
releases can start against the database before putting the old file
back; it never runs the older image's binary, since releases up to 0.2.0
treat an unknown verb as "serve". Every host command goes through a
`Runner` interface, so the sequence is tested with a fake that records
commands ([self-hosting/install.md → Upgrading](../self-hosting/install.md#upgrading)).

## Build and release

```
make generate   buf lint, buf generate, sqlc generate   (output committed)
make build-web  vite build → internal/webui/dist
make build      CGO_ENABLED=0 go build → bin/stoop      (SPA embedded)
make lint       golangci-lint (incl. boundaries) + biome + tsc + theme/style checks
make test       go test ./...
make e2e        the browser suite on its own throwaway server and database
```

`CGO_ENABLED=0` is not incidental. Pure-Go static builds for linux/amd64
and linux/arm64 are what make "a Pi is a first-class host" true, and what
make the release artefact a single file with no runtime dependencies.

**Rebuild after any web change** — the binary embeds `web/dist`, so a
Go-only rebuild ships the previous front end
([../agent-workflow.md](../agent-workflow.md) → Traps).

### CI

Six required jobs, and each protects a specific claim:

| Job | Protects |
| --- | -------- |
| **Protobuf** | `buf lint`, and that the committed `gen/` and `web/src/gen/` match the protos. |
| **Go** | That `internal/dbgen` matches the queries; golangci-lint including the module boundary rules; `go test ./...` against a real Postgres. |
| **Web** | biome, `tsc -b`, and that the SPA builds. |
| **Browser E2E** | The full Playwright suite against a built binary, its own throwaway Postgres, and a LiveKit for the voice spec. |
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
           → http://localhost:8091 for everything: the server proxies the
             web app to Vite on :5173 (STOOP_DEV_WEB_URL), so one origin
             carries the live source for a browser, the desktop shell and
             a phone. Vite alone still answers on :5173.
```

`make dev` prints the branch and commit it runs and warns when
`origin/main` has commits the checkout lacks — the usual reason a dev
instance shows old code.

`make dev-reset` wipes the dev database and seeds a fixed cast across two
spaces. `make e2e` runs on its own scratch database; a spec run pointed at
the dev database by hand wipes it, and `dev-reset` afterwards puts the cast
back.
