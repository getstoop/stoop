-- +goose Up
-- The background-job queue: one row per job, the schedules that
-- materialise periodic jobs, and a heartbeat per running dispatcher.
-- Owned by internal/jobs. See docs/proposals/jobs.md.
CREATE TABLE jobs (
    id           uuid PRIMARY KEY,
    kind         text NOT NULL,
    args         jsonb NOT NULL DEFAULT '{}',
    lane         text,
    sequence     bigint,
    state        text NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'discarded')),
    attempt      int NOT NULL DEFAULT 0,
    max_attempts int NOT NULL,
    not_before   timestamptz NOT NULL,
    leased_until timestamptz,
    started_at   timestamptz,
    finished_at  timestamptz,
    error        text NOT NULL DEFAULT '',
    counters     jsonb,
    created_at   timestamptz NOT NULL
);

CREATE INDEX jobs_due_idx ON jobs (state, not_before) WHERE state IN ('queued', 'running');
CREATE INDEX jobs_kind_started_at_idx ON jobs (kind, started_at DESC);
CREATE INDEX jobs_finished_at_idx ON jobs (finished_at);

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

-- +goose Down
DROP TABLE job_dispatchers;
DROP TABLE job_schedules;
DROP TABLE jobs;
