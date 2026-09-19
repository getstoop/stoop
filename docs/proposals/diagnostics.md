# Diagnostics: answer "why is it slow?" without a debugger

Status: being built, STOOP-224 (children STOOP-320 to STOOP-325). Delete
this file once the last child lands and keep the durable model in
`docs/architecture/diagnostics.md`.

## The shape

- **One tab, six panels, all read-only.** "Diagnostics" is the last entry
  in the Server admin nav (`/admin?tab=diagnostics`), gated by
  `instance.read`. Nothing on it changes a setting; each panel says which
  tab does.
- **Nothing the shell already gives you.** No log viewer, no Go runtime
  internals, no memory meter: the operator has the logs and the command
  line, and the room a process could grow into is a kernel estimate that
  overcommit can break. The page shows what the shell cannot: what Stoop is
  doing across its dependencies.
- **Every number has a named source.** Each panel below lists where each
  field comes from, so nothing on the page is a guess or a derived score.
- **In-memory only, fifteen minutes deep.** Gauges keep a 10-second sample
  ring (90 points). Counters are since start. No metrics table, no
  migration. History is the operator's Prometheus if they have one.
- **Polling, not push.** Each panel's query refetches every 5 s while the
  tab is visible (`refetchInterval: 5000`,
  `refetchIntervalInBackground: false`) and the WebSocket gains no event.
- **One support package, `internal/diag`,** holds the instruments. Modules
  record into it the way they log into slog: instruments are package-level
  vars in the module that owns the number (`var droppedSubscribers =
  diag.Counter("bus_dropped_total")`). The RPCs live on `InstanceService`,
  the module that already owns admin, in
  `proto/stoop/instance/v1/diagnostics.proto` and
  `internal/instance/diagnostics*.go`.
- **A failed panel query renders one `.error` line** in its section and the
  rest of the page keeps refreshing. A diagnostics page that goes blank
  when something is wrong has failed at its one job.
- **Prometheus is a bonus.** `GET /metrics` exposes the registry in text
  format behind a personal token that holds `instance.read`. No config key.

## The panels and their RPCs

All procedures are `needs(authctx.InstanceRead)`. Query keys are
`["diag", "<panel>"]`.

### 1. Health, `GetHealth`

```proto
enum CheckState { OK = 0; WARN = 1; DANGER = 2; OFF = 3; }
message HealthCheck {
  string name = 1;      // postgres · livekit · storage · public_address · webhooks · jobs
  CheckState state = 2;
  string detail = 3;    // the one line on the row, written by the check
  string fix_tab = 4;   // "hosting", "storage", "integrations" or empty
  google.protobuf.Timestamp checked_at = 5;
}
message GetHealthResponse {
  repeated HealthCheck checks = 1;
  google.protobuf.Timestamp server_started_at = 2;
}
```

A check is a port, `func(ctx) instance.Check`, registered with
`UseHealthChecks` from `internal/app`, the only package that can see every
dependency. Each runs on request with a 2-second cache (the
`livekit_status.go` pattern). OFF is a dependency that is not configured,
drawn muted, never a warning. Thresholds live in the check; the client
draws the state it is given.

| Check | Source | Warn | Danger |
| --- | --- | --- | --- |
| postgres | `pool.Ping` timed, `pool.Stat()` | acquire waits in the last minute, or pool at max | ping fails or exceeds 2 s |
| livekit | `liveKitReporter.reachable`, room and participant gauges | — | configured and unreachable |
| storage | `unix.Statfs` on the upload directory, a create-and-delete probe, `GetStorageUsage` | volume 85 % full, or quota 90 % used | volume 95 % full, or the write probe fails |
| public_address | the reachability state `GetReachability` computes | a tunnel or tailnet is configured but reconnecting | configured and down for over a minute |
| webhooks | the queue port: dead-lettered in the last hour | any dead-lettered delivery | the worker has not leased for 5 min with items queued |
| jobs | the job recorder | a job's last run failed, or it is overdue by one interval | overdue by three intervals |

### 2. Right now, `GetLiveStats`

```proto
message Gauge {
  string name = 1;            // connections · online_users · voice_participants · voice_rooms ·
                              // requests_per_minute · request_errors_per_minute ·
                              // bus_dropped_total · webhooks_queued · webhooks_leased · webhooks_dead
  double value = 2;
  repeated double series = 3; // oldest first, up to 90 points; empty for a counter
}
message GetLiveStatsResponse {
  repeated Gauge gauges = 1;
  int32 step_seconds = 2;     // 10
  google.protobuf.Timestamp at = 3;
}
```

A sampler goroutine started in `StartBackground` reads every registered
gauge every 10 s into a ring of 90. Gauges are read functions, not stored
values (`diag.GaugeFunc("connections", gateway.ConnectionCount)`). Six
tiles: connections, online people, in voice, requests per minute, slow
consumers dropped, webhooks queued. Each tile is label, value, a 90-point
inline SVG sparkline (muted line, accent endpoint), one muted subline.

### 3. Database, `GetDatabaseStats`

```proto
message GetDatabaseStatsResponse {
  int32 pool_max = 1;             // pgxpool.Stat().MaxConns()
  int32 pool_acquired = 2;        // AcquiredConns()
  int32 pool_idle = 3;            // IdleConns()
  int64 acquire_waits = 4;        // EmptyAcquireCount(), since start
  int64 acquire_wait_ms = 5;      // AcquireDuration(), since start
  int32 ping_us = 6;
  int64 database_bytes = 7;       // pg_database_size(current_database())
  int32 backends_active = 8;      // pg_stat_activity where datname = current
  int32 backends_idle = 9;
  int32 oldest_transaction_ms = 10;
  string server_version = 11;     // SHOW server_version
  int64 schema_version = 12;      // goose_db_version, max version_id
  int64 schema_floor = 13;        // the floor checkSchemaFloor reads
}
```

A fact grid with a pool meter: accent, warn at 75 %, danger at max, the
`.storage-bar` rule.

### 4. Requests, `GetRequestStats`

```proto
enum StatsWindow { LAST_5_MINUTES = 0; SINCE_START = 1; }
message GetRequestStatsRequest { StatsWindow window = 1; }
message ProcedureStats {
  string procedure = 1;   // "ChatService.ListMessages", package prefix trimmed
  int64 calls = 2;
  int64 errors = 3;       // any connect code except Canceled
  int32 p50_us = 4;
  int32 p95_us = 5;
  int32 max_us = 6;
}
message GetRequestStatsResponse { repeated ProcedureStats procedures = 1; }
```

`diag.Interceptor()` sits in the chain beside auth and rate limit. Per
procedure, a histogram with log-spaced buckets (1 ms to 10 s, 20 buckets):
six one-minute histograms rotated by the sampler for the 5-minute window,
one that never rotates for since-start. Only unary RPCs. A `DataTable`
sorted slowest first, with a two-chip window selector.

### 5. Background work, `ListJobs`

```proto
enum JobOutcome { NEVER_RAN = 0; SUCCEEDED = 1; FAILED = 2; RUNNING = 3; }
message Job {
  string name = 1;                       // "file_sweep" …
  google.protobuf.Duration interval = 2;  // zero for the continuous worker
  google.protobuf.Timestamp last_started = 3;
  int32 last_duration_ms = 4;
  JobOutcome last_outcome = 5;
  string last_error = 6;
  map<string, int64> counters = 7;      // files_removed, bytes_freed, rows_trimmed …
  google.protobuf.Timestamp next_due = 8;
}
message QueueStats { int64 queued = 1; int64 leased = 2; int64 dead = 3; int64 dead_last_hour = 4; }
message ListJobsResponse { repeated Job jobs = 1; QueueStats webhooks = 2; }
```

The sweepers keep their loops. Each module declares its job as a
package-level var (`var fileSweep = diag.Job("file_sweep")`), calls
`fileSweep.Every(interval)` once when the loop starts, and wraps each pass
in `fileSweep.Run(func() (diag.Counters, error))`. "Next due" is the last
start plus the interval. The webhook worker calls `Continuous()`; its queue
counts come from one grouped `SELECT` on `webhook_deliveries` through a
port.

### 6. Metrics endpoint and the report

`GET /metrics` in `internal/app/metrics.go`, beside `/healthz`, writes the
registry in Prometheus text format by hand; the bearer check reuses the
auth service's token verifier and asks for `instance.read`. "Copy report"
is client-side: the five query results plus build info as one JSON
document through `CopyButton`.

## Web layout

`routes/Admin/Diagnostics/index.tsx` (the tab: head, sections, Copy
report), `HealthChecks.tsx`, `LiveTiles.tsx`, `Sparkline.tsx`,
`DatabasePanel.tsx`, `RequestsTable.tsx`, `JobsTable.tsx`, `report.ts`;
`styles/diagnostics.css` (`.health-row`, `.tile`, `.facts`; phone folds in
`mobile.css`); five `useDiag…` hooks in `api/queries.ts`.

## Reading it

| They say | Look at | What it tells you |
| --- | --- | --- |
| "Voice is choppy" | Health: Voice, then Hosting | LiveKit unreachable means the sidecar. Reachable with people in rooms means media, not Stoop: TURN, the network, or the host itself. |
| "Messages take ages to load" | Requests, then Database | A high p95 on `ListMessages` with pool waits means Postgres is saturated. A high p95 with an idle pool means the query itself, or the disk. |
| "My webhook stopped firing" | Background work, then Integrations | Dead-lettered with a 5xx is the receiving end. Queued and never leased is the worker. |
| "People keep dropping" | Right now: Connections, Slow consumers dropped | A sawtooth in connections with drops climbing means the server is falling behind on fan-out. Flat drops with a sawtooth means their network or the proxy in front. |
| "Uploads fail" | Health: File storage | Volume full, quota reached, or the directory is not writable after a restore. |
| "It was fine yesterday" | Copy report | Paste it in an issue. |

## Deliberately out

pprof (a later `STOOP_DEBUG_PPROF=1` on localhost only, if ever),
OpenTelemetry, tracing, a metrics table, retention beyond 15 minutes, a
log viewer, Go runtime internals, memory meters, client-side timings,
alerts (the operator's Prometheus can alert on `stoop_health`).
