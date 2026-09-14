-- Webhook deliveries: the Postgres implementation of the Queue port.
-- Owned by the integrations module; only internal/integrations may use
-- these queries. See docs/proposals/webhooks.md → The queue contract.

-- name: EnqueueDelivery :exec
INSERT INTO webhook_deliveries (id, lane, event_type, sequence, body, not_before)
VALUES ($1, $2, $3, $4, $5, $6);

-- LeaseDeliveries claims due, unfinished, unleased items whose lane has
-- nothing in flight, oldest first.
-- name: LeaseDeliveries :many
UPDATE webhook_deliveries d
SET leased_until = sqlc.arg(until)::timestamptz, attempts = d.attempts + 1
WHERE d.id IN (
    SELECT c.id FROM webhook_deliveries c
    WHERE c.finished_at IS NULL
      AND c.not_before <= now()
      AND (c.leased_until IS NULL OR c.leased_until < now())
      AND NOT EXISTS (
          SELECT 1 FROM webhook_deliveries o
          WHERE o.lane = c.lane AND o.finished_at IS NULL
            AND o.leased_until IS NOT NULL AND o.leased_until >= now()
      )
    ORDER BY c.not_before, c.sequence
    LIMIT sqlc.arg('limit')
    FOR UPDATE SKIP LOCKED
)
RETURNING d.*;

-- name: AckDelivery :exec
UPDATE webhook_deliveries
SET finished_at = now(), leased_until = NULL, body = NULL, status_code = $2, response = $3
WHERE id = $1;

-- name: NackDelivery :exec
UPDATE webhook_deliveries
SET leased_until = NULL, not_before = $2, status_code = $3, response = $4, error = $5
WHERE id = $1;

-- name: DeadDelivery :exec
UPDATE webhook_deliveries
SET finished_at = now(), leased_until = NULL, status_code = $2, response = $3, error = $4
WHERE id = $1;

-- name: GetDelivery :one
SELECT * FROM webhook_deliveries WHERE id = $1;

-- name: ListDeliveriesByLane :many
SELECT * FROM webhook_deliveries WHERE lane = $1 ORDER BY created_at DESC LIMIT $2;

-- name: SweepFinishedDeliveries :execrows
DELETE FROM webhook_deliveries WHERE finished_at IS NOT NULL AND finished_at < $1;
