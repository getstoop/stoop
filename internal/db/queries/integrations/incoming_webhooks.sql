-- Incoming webhooks. Owned by the integrations module.
-- Only internal/integrations may use these queries.

-- name: CreateIncomingWebhook :one
INSERT INTO incoming_webhooks (id, space_id, channel_id, bot_user_id, credential_id, name, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetIncomingWebhook :one
SELECT * FROM incoming_webhooks WHERE id = $1;

-- name: GetIncomingWebhookByCredential :one
SELECT * FROM incoming_webhooks WHERE credential_id = $1;

-- name: ListIncomingWebhooksBySpace :many
SELECT * FROM incoming_webhooks WHERE space_id = $1 ORDER BY created_at, id;

-- name: ListIncomingWebhooks :many
SELECT * FROM incoming_webhooks ORDER BY space_id, created_at, id;

-- name: CountIncomingWebhooksBySpace :one
SELECT count(*) FROM incoming_webhooks WHERE space_id = $1;

-- name: RenameIncomingWebhook :exec
UPDATE incoming_webhooks SET name = $2 WHERE id = $1;

-- SetIncomingWebhookCredential rotates the token; the old credential is
-- revoked by auth.
-- name: SetIncomingWebhookCredential :exec
UPDATE incoming_webhooks SET credential_id = $2, disabled_at = NULL, disabled_reason = '' WHERE id = $1;

-- name: DisableIncomingWebhook :exec
UPDATE incoming_webhooks SET disabled_at = now(), disabled_reason = $2 WHERE id = $1;

-- name: DeleteIncomingWebhook :one
DELETE FROM incoming_webhooks WHERE id = $1 RETURNING *;
