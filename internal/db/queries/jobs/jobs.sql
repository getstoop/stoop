-- The job queue. Owned by the jobs module; only internal/jobs may use
-- these queries. The clock is always the caller's, never now(), so one
-- clock decides due-ness and leases. See docs/proposals/jobs.md.

-- name: InsertJob :exec
INSERT INTO jobs (id, kind, args, lane, sequence, state, attempt, max_attempts, not_before, created_at)
VALUES (sqlc.arg(id), sqlc.arg(kind), sqlc.arg(args), sqlc.narg(lane), sqlc.narg(sequence), 'queued', 0,
        sqlc.arg(max_attempts), sqlc.arg(not_before)::timestamptz, sqlc.arg(now)::timestamptz);

-- LeaseJobs claims due rows of the kinds this dispatcher performs whose
-- lease is absent or lapsed, skipping the rows it still has in flight. A
-- lapsed lease claimed again is a new attempt. A row with a lane is its
-- lane's head: no other unfinished row in the lane has a lower
-- (sequence, id). A head waiting on its backoff holds the lane.
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
      AND NOT (c.id = ANY(sqlc.arg(excluded)::uuid[]))
      AND (c.lane IS NULL OR NOT EXISTS (
          SELECT 1 FROM jobs o
          WHERE o.lane = c.lane AND o.state IN ('queued', 'running')
            AND (o.sequence, o.id) < (c.sequence, c.id)
      ))
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

-- ExtendJobLease never moves a deadline earlier: a renewal keeps an
-- Extend the performer asked for.
-- name: ExtendJobLease :execrows
UPDATE jobs SET leased_until = GREATEST(leased_until, sqlc.arg(until)::timestamptz)
WHERE id = sqlc.arg(id) AND attempt = sqlc.arg(attempt) AND state = 'running';

-- ReleaseJobs clears the lease on a dispatcher's in-flight rows at
-- shutdown and gives back the attempt the lease counted, so the next start
-- retries them at no cost.
-- name: ReleaseJobs :exec
UPDATE jobs SET state = 'queued', leased_until = NULL, attempt = attempt - 1
WHERE state = 'running'
  AND (id, attempt) IN (SELECT unnest(sqlc.arg(ids)::uuid[]), unnest(sqlc.arg(attempts)::int[]));

-- DiscardLane ends a lane's queued rows; a running one finishes on its own.
-- name: DiscardLane :execrows
UPDATE jobs
SET state = 'discarded', finished_at = sqlc.arg(now)::timestamptz, leased_until = NULL, error = sqlc.arg(error)
WHERE lane = sqlc.arg(lane)::text AND state = 'queued';

-- KindBacklog counts a kind's unfinished rows: waiting (queued, or running
-- with a lapsed lease), running on a live lease, and the earliest due
-- not_before among the waiting rows the dispatcher could lease (a row
-- held behind its lane's head is not one), the zero time when none is.
-- name: KindBacklog :one
SELECT
    count(*) FILTER (WHERE j.state = 'queued' OR j.leased_until < sqlc.arg(now)::timestamptz)::bigint AS queued,
    count(*) FILTER (WHERE j.state = 'running' AND j.leased_until >= sqlc.arg(now)::timestamptz)::bigint AS running,
    COALESCE(min(j.not_before) FILTER (WHERE (j.state = 'queued' OR j.leased_until < sqlc.arg(now)::timestamptz)
                                       AND j.not_before <= sqlc.arg(now)::timestamptz
                                       AND (j.lane IS NULL OR NOT EXISTS (
                                           SELECT 1 FROM jobs o
                                           WHERE o.lane = j.lane AND o.state IN ('queued', 'running')
                                             AND (o.sequence, o.id) < (j.sequence, j.id)
                                       ))),
             '0001-01-01 00:00:00+00'::timestamptz)::timestamptz AS oldest_due
FROM jobs j
WHERE j.kind = sqlc.arg(kind) AND j.state IN ('queued', 'running');

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
