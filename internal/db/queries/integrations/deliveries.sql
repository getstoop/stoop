-- The delivery log: one row per outgoing delivery, inserted before its job
-- is queued and updated by the deliver_webhook job after each attempt.
-- Owned by the integrations module; only internal/integrations may use
-- these queries. See docs/architecture/integrations.md → Outgoing.

-- name: InsertDelivery :exec
INSERT INTO webhook_deliveries (id, webhook_id, event_type, sequence, body, created_at)
VALUES ($1, $2, $3, $4, $5, sqlc.arg(now)::timestamptz);

-- RecordDeliveryAttempt writes what one try learned; finished_at is set
-- once the delivery is delivered or dead, and a delivered body is not kept.
-- name: RecordDeliveryAttempt :exec
UPDATE webhook_deliveries
SET attempts = sqlc.arg(attempts), status_code = sqlc.narg(status_code),
    response = sqlc.arg(response), error = sqlc.arg(error),
    finished_at = sqlc.narg(finished_at)::timestamptz,
    body = CASE WHEN sqlc.arg(delivered)::boolean THEN NULL ELSE body END
WHERE id = sqlc.arg(id);

-- name: GetDelivery :one
SELECT * FROM webhook_deliveries WHERE id = $1;

-- name: ListDeliveriesByWebhook :many
SELECT * FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY created_at DESC, sequence DESC LIMIT $2;

-- name: SweepFinishedDeliveries :execrows
DELETE FROM webhook_deliveries WHERE finished_at IS NOT NULL AND finished_at < sqlc.arg(before)::timestamptz;
