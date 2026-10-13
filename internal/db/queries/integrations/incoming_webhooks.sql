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

-- ListIncomingWebhooksBySpaceForReader leaves out a hook into a private
-- channel the reader is not in.
-- name: ListIncomingWebhooksBySpaceForReader :many
SELECT h.* FROM incoming_webhooks h
JOIN channel_readers r ON r.channel_id = h.channel_id AND r.user_id = sqlc.arg('user_id')
WHERE h.space_id = sqlc.arg('space_id') ORDER BY h.created_at, h.id;

-- name: ListIncomingWebhooks :many
SELECT * FROM incoming_webhooks ORDER BY space_id, created_at, id;

-- name: CountIncomingWebhooksBySpace :one
SELECT count(*) FROM incoming_webhooks WHERE space_id = $1;

-- name: RenameIncomingWebhook :exec
UPDATE incoming_webhooks SET name = $2 WHERE id = $1;

-- SetIncomingWebhookCredential rotates the token and leaves the on/off
-- state alone; the old credential is revoked by auth.
-- name: SetIncomingWebhookCredential :exec
UPDATE incoming_webhooks SET credential_id = $2 WHERE id = $1;

-- name: EnableIncomingWebhook :exec
UPDATE incoming_webhooks SET disabled_at = NULL, disabled_reason = '' WHERE id = $1;

-- name: DisableIncomingWebhook :exec
UPDATE incoming_webhooks SET disabled_at = now(), disabled_reason = $2 WHERE id = $1;

-- name: DeleteIncomingWebhook :one
DELETE FROM incoming_webhooks WHERE id = $1 RETURNING *;

-- CountIncomingWebhooksForBotInChannel is how many hooks post into a
-- channel as one bot: what says whether the bot still needs to be there.
-- name: CountIncomingWebhooksForBotInChannel :one
SELECT count(*) FROM incoming_webhooks WHERE channel_id = $1 AND bot_user_id = $2;
