-- The job queue. Owned by the jobs module; only internal/jobs may use
-- these queries. The clock is always the caller's, never now(), so one
-- clock decides due-ness and leases. See docs/proposals/jobs.md.

-- name: InsertJob :exec
INSERT INTO jobs (id, kind, args, state, attempt, max_attempts, not_before, created_at)
VALUES ($1, $2, $3, 'queued', 0, $4, sqlc.arg(not_before)::timestamptz, sqlc.arg(now)::timestamptz);

-- LeaseJobs claims due rows of the kinds this dispatcher performs whose
-- lease is absent or lapsed. A lapsed lease claimed again is a new attempt.
-- name: LeaseJobs :many
UPDATE jobs j
SET state = 'running', leased_until = sqlc.arg(until)::timestamptz, started_at = sqlc.arg(now)::timestamptz,
    finished_at = NULL, attempt = j.attempt + 1
WHERE j.id IN (
    SELECT c.id FROM jobs c
    WHERE c.state IN ('queued', 'running')
      AND c.kind = ANY(sqlc.arg(kinds)::text[])
      AND c.not_before <= sqlc.arg(now)::timestamptz
      AND (c.leased_until IS NULL OR c.leased_until < sqlc.arg(now)::timestamptz)
    ORDER BY c.not_before, c.created_at
    LIMIT sqlc.arg('limit')
    FOR UPDATE SKIP LOCKED
)
RETURNING j.*;

-- The outcome writes match the attempt they were leased for, so a stale
-- attempt whose lease lapsed changes nothing.
-- name: FinishJob :execrows
UPDATE jobs
SET state = sqlc.arg(state), finished_at = sqlc.arg(now)::timestamptz, leased_until = NULL,
    error = sqlc.arg(error), counters = sqlc.narg(counters)
WHERE id = sqlc.arg(id) AND attempt = sqlc.arg(attempt);

-- name: RequeueJob :execrows
UPDATE jobs
SET state = 'queued', leased_until = NULL, finished_at = sqlc.arg(now)::timestamptz,
    error = sqlc.arg(error), counters = sqlc.narg(counters), not_before = sqlc.arg(not_before)::timestamptz
WHERE id = sqlc.arg(id) AND attempt = sqlc.arg(attempt);

-- name: ExtendJobLease :execrows
UPDATE jobs SET leased_until = sqlc.arg(until)::timestamptz
WHERE id = sqlc.arg(id) AND attempt = sqlc.arg(attempt) AND state = 'running';

-- ReleaseJobs clears the lease on a dispatcher's in-flight rows at
-- shutdown, so the next start retries them.
-- name: ReleaseJobs :exec
UPDATE jobs SET state = 'queued', leased_until = NULL
WHERE state = 'running'
  AND (id, attempt) IN (SELECT unnest(sqlc.arg(ids)::uuid[]), unnest(sqlc.arg(attempts)::int[]));

-- name: GetJob :one
SELECT * FROM jobs WHERE id = $1;

-- name: LastStartedJob :one
SELECT * FROM jobs WHERE kind = $1 AND started_at IS NOT NULL ORDER BY started_at DESC LIMIT 1;

-- name: LastSucceededJob :one
SELECT * FROM jobs WHERE kind = $1 AND state = 'succeeded' ORDER BY started_at DESC LIMIT 1;

-- name: CountQueuedJobs :one
SELECT count(*) FROM jobs WHERE kind = $1 AND state = 'queued';

-- name: SweepFinishedJobs :execrows
DELETE FROM jobs WHERE state IN ('succeeded', 'discarded') AND finished_at < sqlc.arg(before)::timestamptz;
