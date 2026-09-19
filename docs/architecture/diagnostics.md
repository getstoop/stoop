# Diagnostics: the tab, the instruments, and `/metrics`

The Diagnostics tab answers "why is it slow?" from inside the app, without
a debugger and without a metrics stack. This document is the model behind
it; the operator's how-to is
[../self-hosting.md](../self-hosting.md#diagnostics).

```
  module code ──► internal/diag (counters · gauges · timings · jobs, in memory)
                        │                        │
        InstanceService RPCs, every 5 s      GET /metrics, text format
                        │                        │
             /admin?tab=diagnostics        the operator's Prometheus
```

## The shape

- **One tab, five panels and a Copy report, all read-only.** "Diagnostics" is the last entry
  in the Server admin nav, gated by `instance.read`. Nothing on it changes
  a setting; a row that needs one links to the tab that does.
- **Nothing the shell already gives you.** No log viewer, no Go runtime
  internals, no memory meter. The page shows what the shell cannot: what
  Stoop is doing across its dependencies.
- **Every number has a named source.** The panel tables below say where
  each field is read from; nothing is a derived score.
- **In memory, fifteen minutes deep.** Gauges keep a ring of 90 samples at
  10 s. Counters and timings are since start. There is no metrics table
  and no migration; history is the operator's Prometheus.
- **Polling, not push.** Each panel's query refetches every 5 s while the
  tab is open and visible (`refetchInterval: 5000`,
  `refetchIntervalInBackground: false`). The WebSocket carries no
  diagnostics event.
- **A failed panel is one `.error` line** in its section; the other panels
  keep refreshing.

## The `internal/diag` package

A support package, not a module: it owns no table and imports nothing
from the modules. `diag.Default` is the one registry, used the way slog's
default logger is. A module declares its instrument as a package-level
var next to the code that owns the number:

```go
var droppedSubscribers = diag.NewCounter("bus_dropped_total", "Subscribers dropped for falling behind.")
var fileSweep = diag.NewJob("file_sweep")
diag.NewGauge("connections", "Open WebSocket sessions.", func() float64 { … })
```

| Instrument | What it is | Recorded by |
| --- | --- | --- |
| `Counter` | A monotonic count since start. | `Inc`, `Add`. |
| `Gauge` | A read function; the sampler stores its last 90 values. | Registered with the function; never written to. |
| `Job` | One background loop's passes. | `Every(interval)` or `Continuous()` once, then `Run(func() (Counters, error))` around each pass. |
| `RPCStats` | Per-procedure timings and error counts. | `diag.Interceptor()`, outermost in the Connect chain so refused calls are timed too. |

Timings are a histogram with 20 log-spaced buckets from 1 ms to 10 s per
procedure: six one-minute histograms rotated by the sampler for the
5-minute window, and one that never rotates for since-start. Only unary
RPCs are timed; the procedure name is the package prefix trimmed
(`ChatService.ListMessages`).

**The sampler** (`RunSampler`, started from `App.StartBackground`) reads
every gauge every `SampleStep` (10 s) into its ring and rotates the RPC
minute histograms on each minute boundary.

**The gauges** are registered in `internal/app` (`gauges.go`), the only
package that sees the gateway: `connections`, `online_users`,
`voice_rooms`, `voice_participants`, `requests_per_minute` and
`request_errors_per_minute` (a counter turned into a rate over the last
minute of samples). Every gauge is read from memory; nothing the sampler
does touches Postgres.

**The webhook queue is not a gauge.** Its counts (one grouped `SELECT` on
`webhook_deliveries`, `webhook_queue.go`) are taken only when something
asks: the Health row, the Background work panel, the sixth tile and a
metrics scrape share a 10 s cache, so a tab polling every 5 s costs one
count per TTL and an idle server runs none. The tile therefore has no
sparkline.

## The health-check port

`instance.HealthCheck` is a port: a name, the admin tab that fixes it, and
`Run(ctx) (CheckState, string)`. `internal/app` registers the checks with
`UseHealthChecks` in the order the panel lists them. Each runs on request
under a 3 s timeout, its answer cached for 2 s, so a polling page never
hammers a dependency. `OFF` is a dependency that is not configured: drawn
muted, never a warning. Thresholds live in the check; the client draws the
state it is given.

| Check | Reads | Warn | Danger |
| --- | --- | --- | --- |
| `postgres` | `pool.Ping` timed, `pool.Stat()` | acquire waits in the last minute, or the pool at max | ping fails or takes over 2 s |
| `livekit` | the Hosting page's reachability probe | — | configured and unreachable |
| `storage` | `statfs` on the upload directory, a create-and-delete probe, the quota | volume 85 % full, or quota 90 % used | volume 95 % full, or the probe fails |
| `public_address` | the reachability state `GetReachability` computes | a tunnel or tailnet is configured but reconnecting | configured and down for over a minute |
| `webhooks` | the queue port | any delivery dead-lettered in the last hour | the worker has not run for 5 min with items queued |
| `jobs` | the job records | a pass failed, or a job is one interval overdue | three intervals overdue |

## The panels and what they read

All five procedures are on `InstanceService`, `needs(instance.read)`,
under query keys `["diag", "<panel>"]`
(`proto/stoop/instance/v1/diagnostics.proto`,
`internal/instance/diagnostics*.go`).

| Panel | RPC | Reads |
| --- | --- | --- |
| Health | `GetHealth` | the checks above, plus when the process started |
| Right now | `GetLiveStats` | every gauge with its ring, and every counter, from the registry snapshot |
| Database | `GetDatabaseStats` | `pgxpool.Stat()` (max, acquired, idle, empty-acquire count and wait time), a timed `Ping`, and one query for `pg_database_size`, `pg_stat_activity` counts, the oldest transaction, `server_version`; the goose version from `goose_db_version` |
| Requests | `GetRequestStats` | `RPCStats` over the last five minutes: calls, errors (any code but Canceled), p50, p95, max. Since-start is on the metrics endpoint only |
| Background work | `ListJobs` | every `Job` record (interval, last start, duration, outcome, error, counters, next due) and the queue port's counts |

The sixth tile, Webhooks queued, and the two queue rows on Background work
read the same cached queue count.

## The web side

`routes/Admin/Diagnostics/`: `index.tsx` (the head line, Copy report, one
section per panel), `HealthChecks.tsx`, `LiveTiles.tsx` with
`Sparkline.tsx`, `DatabasePanel.tsx`, `RequestsTable.tsx`, `JobsTable.tsx`,
the formatters in `format.ts`, and `report.ts`. The hooks are the
`useDiag…` family in `api/queries.ts`; the styles are
`styles/diagnostics.css`.

**Copy report** is client-side: `report.ts` reads the five panels off the
query cache, converts each with `toJson` (int64 fields are strings), and
adds the build, the instance name and an `at` timestamp. A panel the tab
has not loaded is left out.

**The nav dot** on the Diagnostics entry reads health through
`useDiagHealthOnce`: the same query key, a minute's `staleTime` and no
interval, so the shell shares the tab's cache without polling from every
admin tab. It shows for WARN or DANGER, never OFF.

## `GET /metrics`

`internal/app/metrics.go`, mounted beside `/healthz`. It writes the
registry in the Prometheus text format (`diag.WriteText`, by hand, no
client library): counters as `stoop_<name>_total`, gauges as
`stoop_<name>`, `stoop_rpc_calls_total`, `stoop_rpc_errors_total` and the
`stoop_rpc_duration_seconds` histogram by `procedure`, and
`stoop_job_last_success_timestamp_seconds` /
`stoop_job_last_duration_seconds` by `job`. `internal/app` then appends
the two families only it can know, so `diag` stays a plain registry:
`stoop_health{check="…"}` (0 ok, 1 warn, 2 danger, 3 off, from
`instance.Service.HealthSnapshot`, the same 2 s cache as the panel) and
`stoop_build_info{version,commit,go} 1`.

**Auth** is the Connect gate over HTTP: the request must carry
`Authorization: Bearer <token>`; the token goes through
`auth.Service.VerifyToken`, the same path as the interceptor, and the
identity must pass `authctx.Allows(InstanceRead)`, so both the holder's
role and the token's grant count. No or an invalid token is `401` with
`WWW-Authenticate: Bearer`; a token that verifies but lacks the action is
`403`. The session cookie is not read. Responses are
`text/plain; version=0.0.4` with `Cache-Control: no-store`. There is no
config key: a personal token that holds `instance.read` is the switch.

## Deliberately out

pprof, OpenTelemetry, tracing, a metrics table, retention beyond fifteen
minutes, a log viewer, Go runtime internals, memory meters, client-side
timings, and alerts. Each is either something the shell already provides
or something the operator's Prometheus does better (`stoop_health` is
there to alert on). A `STOOP_DEBUG_PPROF` on localhost may come later if a
real profile is ever needed.
