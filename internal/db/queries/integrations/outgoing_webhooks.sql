-- Outgoing webhooks. Owned by the integrations module.
-- Only internal/integrations may use these queries.

-- name: CreateOutgoingWebhook :one
INSERT INTO outgoing_webhooks (id, space_id, channel_id, url, secret, event_types, name, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetOutgoingWebhook :one
SELECT * FROM outgoing_webhooks WHERE id = $1;

-- name: ListOutgoingWebhooksBySpace :many
SELECT * FROM outgoing_webhooks WHERE space_id = $1 ORDER BY created_at, id;

-- ListOutgoingWebhooksBySpaceForReader leaves out a hook filtered to a
-- private channel the reader is not in.
-- name: ListOutgoingWebhooksBySpaceForReader :many
SELECT h.* FROM outgoing_webhooks h
WHERE h.space_id = sqlc.arg('space_id')
  AND (h.channel_id IS NULL OR EXISTS (
      SELECT 1 FROM channel_readers r
      WHERE r.channel_id = h.channel_id AND r.user_id = sqlc.arg('user_id')))
ORDER BY h.created_at, h.id;

-- name: ListOutgoingWebhooks :many
SELECT * FROM outgoing_webhooks ORDER BY space_id, created_at, id;

-- ListEnabledOutgoingWebhooksBySpace is the subscriber's match list.
-- name: ListEnabledOutgoingWebhooksBySpace :many
SELECT * FROM outgoing_webhooks WHERE space_id = $1 AND disabled_at IS NULL ORDER BY id;

-- name: CountOutgoingWebhooksBySpace :one
SELECT count(*) FROM outgoing_webhooks WHERE space_id = $1;

-- name: UpdateOutgoingWebhook :exec
UPDATE outgoing_webhooks
SET name = $2, url = $3, channel_id = $4, event_types = $5
WHERE id = $1;

-- name: SetOutgoingWebhookSecret :exec
UPDATE outgoing_webhooks SET secret = $2 WHERE id = $1;

-- NextOutgoingSequence takes the Stoop-Sequence number for one delivery.
-- name: NextOutgoingSequence :one
UPDATE outgoing_webhooks SET sequence = sequence + 1 WHERE id = $1 RETURNING sequence;

-- name: DisableOutgoingWebhook :exec
UPDATE outgoing_webhooks SET disabled_at = now(), disabled_reason = $2 WHERE id = $1;

-- name: EnableOutgoingWebhook :exec
UPDATE outgoing_webhooks SET disabled_at = NULL, disabled_reason = '' WHERE id = $1;

-- name: DeleteOutgoingWebhook :one
DELETE FROM outgoing_webhooks WHERE id = $1 RETURNING *;
