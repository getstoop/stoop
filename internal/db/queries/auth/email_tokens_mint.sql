-- Email link tokens, minting side. Owned by the auth module.
-- Only internal/auth may use these queries.

-- GetEmailRecipient is what a send_email builder needs about the user.
-- name: GetEmailRecipient :one
SELECT username, pending_email, (deactivated_at IS NOT NULL)::bool AS deactivated
FROM users
WHERE id = $1;

-- RevokeUnusedEmailTokens removes the user's unused tokens of a purpose,
-- so only the newest link works.
-- name: RevokeUnusedEmailTokens :exec
DELETE FROM email_tokens
WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL;

-- name: CreateEmailToken :exec
INSERT INTO email_tokens (id, user_id, purpose, token_hash, address, expires_at)
VALUES ($1, $2, $3, $4, $5, $6);
