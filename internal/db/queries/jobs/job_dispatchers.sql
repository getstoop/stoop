-- Dispatcher heartbeats. Owned by the jobs module.

-- name: InsertDispatcher :exec
INSERT INTO job_dispatchers (id, host, workers, started_at, seen_at)
VALUES ($1, $2, $3, sqlc.arg(now)::timestamptz, sqlc.arg(now)::timestamptz);

-- name: TouchDispatcher :exec
UPDATE job_dispatchers SET seen_at = sqlc.arg(now)::timestamptz WHERE id = sqlc.arg(id);

-- name: DeleteDispatcher :exec
DELETE FROM job_dispatchers WHERE id = $1;

-- name: SweepDispatchers :execrows
DELETE FROM job_dispatchers WHERE seen_at < sqlc.arg(before)::timestamptz;

-- name: ListDispatchers :many
SELECT * FROM job_dispatchers ORDER BY seen_at DESC, id;
