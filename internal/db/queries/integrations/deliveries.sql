-- Webhook deliveries: the Postgres implementation of the Queue port.
-- Owned by the integrations module; only internal/integrations may use
-- these queries. The clock is always the caller's, never now(), so one
-- clock decides due-ness and leases.
-- See docs/architecture/integrations.md → The queue.

-- name: EnqueueDelivery :exec
INSERT INTO webhook_deliveries (id, lane, event_type, sequence, body, not_before, created_at)
VALUES ($1, $2, $3, $4, $5, sqlc.arg(not_before)::timestamptz, sqlc.arg(now)::timestamptz);

-- LeaseDeliveries claims due, unleased items that are the oldest
-- unfinished item of their lane, so a lane has one in flight and stays
-- in sequence order.
-- name: LeaseDeliveries :many
UPDATE webhook_deliveries d
SET leased_until = sqlc.arg(until)::timestamptz, attempts = d.attempts + 1
WHERE d.id IN (
    SELECT c.id FROM webhook_deliveries c
    WHERE c.finished_at IS NULL
      AND c.not_before <= sqlc.arg(now)::timestamptz
      AND (c.leased_until IS NULL OR c.leased_until < sqlc.arg(now)::timestamptz)
      AND NOT EXISTS (
          SELECT 1 FROM webhook_deliveries o
          WHERE o.lane = c.lane AND o.finished_at IS NULL
            AND (o.sequence, o.id) < (c.sequence, c.id)
      )
    ORDER BY c.not_before, c.sequence
    LIMIT sqlc.arg('limit')
    FOR UPDATE SKIP LOCKED
)
RETURNING d.*;

-- name: AckDelivery :exec
UPDATE webhook_deliveries
SET finished_at = sqlc.arg(now)::timestamptz, leased_until = NULL, body = NULL,
    status_code = sqlc.narg(status_code), response = sqlc.arg(response), error = ''
WHERE id = sqlc.arg(id);

-- name: NackDelivery :exec
UPDATE webhook_deliveries
SET leased_until = NULL, not_before = sqlc.arg(not_before)::timestamptz,
    status_code = sqlc.narg(status_code), response = sqlc.arg(response), error = sqlc.arg(error)
WHERE id = sqlc.arg(id);

-- name: DeadDelivery :exec
UPDATE webhook_deliveries
SET finished_at = sqlc.arg(now)::timestamptz, leased_until = NULL,
    status_code = sqlc.narg(status_code), response = sqlc.arg(response), error = sqlc.arg(error)
WHERE id = sqlc.arg(id);

-- name: GetDelivery :one
SELECT * FROM webhook_deliveries WHERE id = $1;

-- name: ListDeliveriesByLane :many
SELECT * FROM webhook_deliveries WHERE lane = $1 ORDER BY created_at DESC, sequence DESC LIMIT $2;

-- name: SweepFinishedDeliveries :execrows
DELETE FROM webhook_deliveries WHERE finished_at IS NOT NULL AND finished_at < sqlc.arg(before)::timestamptz;
