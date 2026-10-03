# Background jobs: one runner for the sweeps, the webhooks and what comes next

Status: draft 2026-10-03, for review. Supersedes STOOP-378; narrows
STOOP-363. Nothing here is built.

## What exists

- Six sweepers, each a goroutine started from `App.StartBackground`
  ([architecture/runtime.md → Background work](../architecture/runtime.md#background-work)):
  wait a start-up delay, run once, then run on a ticker. The fifteen-line
  loop is copied into all six files; only the delay, the interval, the
  function and the `diag.Job` var differ.
- The outgoing-webhook worker: a Postgres queue (`webhook_deliveries`,
  leased with `FOR UPDATE SKIP LOCKED`, one in flight per hook, a retry
  ladder, dead-lettering) behind the `integrations.Queue` port, and a
  goroutine woken by a Go channel on enqueue
  ([architecture/integrations.md → The queue](../architecture/integrations.md#the-queue)).
- Job state for the Diagnostics tab, the `jobs` and `webhooks` health
  checks and the `stoop_job_*` metrics families lives in memory, in
  `internal/diag` ([architecture/diagnostics.md](../architecture/diagnostics.md)).
- Shutdown cancels the context and closes the pool without waiting for
  any of these goroutines (STOOP-363).
- Only the file sweep can be run by hand (`FileService.SweepFiles`), and
  that run is not recorded.

## The problem

1. The schedule is in memory. A restart resets every timer, a sweep that
   is mid-pass at shutdown has the database closed under it, and nothing
   but the file sweep can be triggered by an operator.
2. There is no place for a job that must survive a restart and be
   retried. Image normalisation runs in the upload request; an import, an
   export or an email would have nowhere to go.
3. A runaway job shares memory and CPU with the chat server. There is no
   way to cap it or to restart it apart from the server.
4. The loop is written six times, and a seventh queue-shaped loop exists
   for webhooks.

## The shape

One module, `internal/jobs`, owns a queue in Postgres and a runner that
works it. Everything the runner knows is in the tables, so the runner can
live in the stoop process (phase 1) or in its own process and container
(phase 3) without changing.

```
  module code ──► Jobs port ──► jobs.Scheduler ──► jobs table
                                                      │
                               jobs.Dispatcher ◄── lease (SKIP LOCKED)
                                      │
                           worker 1 … worker N ──► Performer.Perform(ctx, job)
                                      │
                               write outcome ──► jobs table ──► Diagnostics, health, /metrics
```

### Tables

```sql
CREATE TABLE jobs (
    id           uuid PRIMARY KEY,                 -- UUIDv7
    kind         text NOT NULL,
    args         jsonb NOT NULL DEFAULT '{}',
    lane         text,                             -- set: one in flight per lane, in sequence order
    sequence     bigint,
    state        text NOT NULL,                    -- queued | running | succeeded | discarded
    attempt      int NOT NULL DEFAULT 0,
    max_attempts int NOT NULL,
    not_before   timestamptz NOT NULL,
    leased_until timestamptz,
    started_at   timestamptz,
    finished_at  timestamptz,
    error        text NOT NULL DEFAULT '',
    attempts     jsonb,                            -- earlier attempts: attempt, started_at, finished_at, error
    counters     jsonb,
    created_at   timestamptz NOT NULL
);

CREATE TABLE job_schedules (
    kind         text PRIMARY KEY,
    interval_ms  bigint NOT NULL,
    enabled      boolean NOT NULL,
    next_due     timestamptz NOT NULL,
    last_job_id  uuid
);

CREATE TABLE job_dispatchers (
    id           uuid PRIMARY KEY,
    host         text NOT NULL,
    workers      int NOT NULL,
    started_at   timestamptz NOT NULL,
    seen_at      timestamptz NOT NULL
);
```

`jobs` is the queue and the history: one row per run. A failed attempt
that will be retried goes back to `queued` with a later `not_before`; the
error and attempt count stay on the row, and the dispatcher appends the
failed attempt to `attempts`, so a retried job is one row with its whole
history on it. `job_schedules` is one row per
periodic kind; the dispatcher inserts a `jobs` row when `next_due` passes
and advances it. `job_dispatchers` is a heartbeat, so the Diagnostics tab
and the main process can tell whether a runner is alive wherever it runs.

### The Go side

```go
// Scheduler is what callers use. An unknown kind is refused, not stored.
type Scheduler interface {
    Enqueue(ctx context.Context, kind string, args any) (id string, err error)
    EnqueueAt(ctx context.Context, kind string, args any, at time.Time) (id string, err error)
}

// Performer does the work. nil is success; an error is a failure the
// dispatcher retries by policy, unless the error says otherwise.
type Performer interface {
    Perform(ctx context.Context, job *Job) error
}

func RetryIn(err error, after time.Duration) error // retry at a chosen time
func Discard(err error) error                      // fail, never retry

// Job is what a performer is handed.
type Job struct {
    ID, Kind string
    Attempt  int
    // Args decodes the JSON arguments into v.
    Args     func(v any) error
    // Record attaches counters to the row ("files_removed": 14).
    Record   func(Counters)
    // Extend pushes the lease deadline for a long pass.
    Extend   func(time.Duration) error
}

// Register binds a kind to a typed performer; the generic wrapper does
// the JSON decode.
func Register[A any](r *Registry, kind string, fn func(ctx context.Context, job *Job, args A) error, opts Options)
```

The dispatcher is one goroutine: lease up to the batch size of due rows,
hand each to a free worker, repeat on a short poll. Workers are
goroutines, `STOOP_JOBS_WORKERS` of them. The worker calls `Perform`,
recovers a panic as a failure, and writes the outcome the moment
`Perform` returns. The return value is how the outcome reaches the row;
a performer cannot forget to report and nothing is left `running`.

A lease, not a flag: `running` means `leased_until` is in the future. A
row whose lease has passed is claimable again, so a runner that dies
mid-job needs no rescuer. `Extend` is for the rare job that outlives the
default lease.

Retry policy is per kind, in `Options`: max attempts and a backoff
ladder. The default ladder is the webhook worker's (5 s, 30 s, 2 min).
`lane` keeps one job in flight per lane in `sequence` order, which is the
webhook rule; sweeps have no lane.

On shutdown the dispatcher stops leasing, waits for in-flight jobs up to
the existing ten-second budget, then clears the lease on anything still
running so it is retried on the next start.

### Rules

- **`jobs` is a module.** It owns its tables and imports no module.
  Modules reach the scheduler through their own port (a `Jobs` interface
  with the methods they use), wired in `internal/app`. Performers are
  registered in `internal/app`, which is the only package that sees both
  the registry and the module methods.
- **A module enqueues only kinds it performs.** The argument type for a
  kind is declared next to the performer in the owning module. Another
  module wanting that work publishes an event instead, as today.
- **The runner holds nothing it cannot rebuild from the tables.** No
  in-memory wake channel between enqueuer and dispatcher. Phase 1 polls;
  `LISTEN/NOTIFY` on insert is added if the poll latency matters.
- **Diagnostics reads the tables.** `ListJobs`, the `jobs` and
  `webhooks` health checks and the `stoop_job_*` metrics read the jobs
  module through a port on `instance`, from phase 1. `diag.Job` goes when
  its last user goes (phase 2).
- **Finished rows have a retention.** `STOOP_JOBS_RETENTION` (default
  168 h, the delivery-log default today), swept by the `sweep_jobs` kind.

### Configuration

| Variable | Default | Phase |
| --- | --- | --- |
| `STOOP_JOBS_WORKERS` | 4 | 1 |
| `STOOP_JOBS_POLL` | 2s | 1 |
| `STOOP_JOBS_RETENTION` | 168h | 1 |
| `STOOP_JOBS` | `embedded` (`external` to run none in the main process) | 3 |

`STOOP_FILE_SWEEP_INTERVAL`, `STOOP_FILE_SWEEP_GRACE`,
`STOOP_ACTIVITY_RETENTION` and `STOOP_WEBHOOK_DELIVERY_RETENTION` keep
their meaning; an interval of 0 sets the schedule row `enabled = false`.

## Phases

Each phase ships alone and leaves nothing half built.

**Phase 1: the module and the six sweepers.** Migration for the three
tables. `internal/jobs` with Scheduler, Dispatcher, Registry, the
Performer contract and the schedule loop. The six sweep functions stay
where they are; `internal/app` registers them as kinds and schedules
them. A new schedule row gets `next_due = now + 2 min`, so a fresh
install sweeps soon after boot and a restart does not re-sweep.
`FileService.SweepFiles` enqueues `sweep_files` and returns the job id.
`instance.ListJobs`, the `jobs` health check and the metrics families
read the tables. The six loop copies, their start-up delays and
`RunSampler`'s siblings in `StartBackground` are deleted; a `WaitGroup`
on `App` covers the goroutines that remain (the rest of STOOP-363).
Closes STOOP-378.

**Phase 2: one-shot jobs and the webhook swap.** Lanes and the retry
ladder in the lease query, lifted from `webhook_deliveries`. A
`deliver_webhook` kind on `integrations.Service`; `SendMessage`'s fan-out
enqueues it through the module's `Jobs` port. `webhook_deliveries`
becomes the delivery log the Integrations page reads (hook, event,
status code, response, error, attempts, finished), written by the
performer after each attempt; its queue columns, `PostgresQueue`, the
`Queue` port, `RunWorker` and the wake channel are deleted. `diag.Job`
goes with them. Hook deletion cancels the lane's queued jobs explicitly,
since the generic table cannot carry the foreign key.

**Phase 3: `stoop jobs` as a process.** A subcommand that builds the
composition root without the HTTP listener, the gateway or the voice
proxy, and runs only the dispatcher. `STOOP_JOBS=external` tells the main
process to run none. The dispatcher heartbeat drives a `jobs runner`
health row: warn when no dispatcher has been seen for a minute. The
Compose files gain a `jobs` service with a memory limit and
`restart: unless-stopped`; the main process can spawn and supervise the
child where Compose is not in use, the way `internal/cftunnel` supervises
cloudflared. `LISTEN/NOTIFY` wake-ups replace polling for enqueue latency.
With the local-disk blob store the runner shares the host or the volume;
the docs say so.

**Phase 4: jobs that earn the isolation.** Image normalisation for
avatars and icons moves off the upload request onto the runner. Per-kind
concurrency caps. Whatever one-shot work comes next.

## Testing

Module tests against Postgres, as the webhook queue has today: two
dispatchers cannot lease the same row; a lane keeps one in flight; a
failed attempt lands at the ladder's time; a schedule inserts once per
interval and survives a restart with `next_due` intact; shutdown clears
leases on in-flight jobs. The in-process HTTP harness
(`internal/app/e2e_*_test.go`) checks that `SweepFiles` enqueues and
that `ListJobs` shows the row.

## Decisions

Made on 2026-10-03 while shaping this:

- Build our own; no job library. The lease pattern is already proven in
  the webhook queue and the feature list is small and fixed. A need past
  this document is the moment to adopt a library, not extend.
- Periodic jobs are schedules that materialise queue rows, so every pass
  is a history row and run-now is an insert.
- The outcome is `Perform`'s return value; the dispatcher writes it.
- `Enqueue` queues for now and `EnqueueAt` for a time: they say what happens. No `Perform…` names on the scheduler, which read as a delay or as an inline run.
- "Dispatcher" for the poller; "supervisor" is reserved for the process
  minder in phase 3.
- The runner is in-process by default. A second process is the
  operator's choice, never the default install.

Settled on 2026-10-03 after review:

- `STOOP_JOBS_WORKERS` defaults to 4.
- `SweepFiles` enqueues and returns the job id. A synchronous run would
  defeat the point of it being a job.
- One row per run, with retention. Retries stay on the row, logged in
  `attempts`.
