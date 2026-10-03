-- Periodic kinds. Owned by the jobs module.

-- UpsertSchedule creates a row due at first_due, or updates one and pulls
-- its next_due forward to moved_due when that comes first.
-- name: UpsertSchedule :exec
INSERT INTO job_schedules (kind, interval_ms, enabled, next_due)
VALUES (sqlc.arg(kind), sqlc.arg(interval_ms), sqlc.arg(enabled), sqlc.arg(first_due)::timestamptz)
ON CONFLICT (kind) DO UPDATE
SET interval_ms = EXCLUDED.interval_ms,
    enabled = EXCLUDED.enabled,
    next_due = CASE WHEN EXCLUDED.enabled
                    THEN LEAST(job_schedules.next_due, sqlc.arg(moved_due)::timestamptz)
                    ELSE job_schedules.next_due END;

-- DueSchedules locks the due rows for the caller's transaction; SKIP
-- LOCKED keeps two dispatchers from inserting the same run.
-- name: DueSchedules :many
SELECT * FROM job_schedules
WHERE enabled AND next_due <= sqlc.arg(now)::timestamptz
ORDER BY kind
FOR UPDATE SKIP LOCKED;

-- name: AdvanceSchedule :exec
UPDATE job_schedules SET next_due = sqlc.arg(next_due)::timestamptz, last_job_id = sqlc.arg(last_job_id)
WHERE kind = sqlc.arg(kind);

-- name: ListSchedules :many
SELECT * FROM job_schedules ORDER BY kind;
