-- Email link tokens, minting side. Owned by the auth module.
-- Only internal/auth may use these queries.

-- GetEmailRecipient is what a send_email builder needs about the user.
-- name: GetEmailRecipient :one
SELECT username, email, pending_email, kind, role, (deactivated_at IS NOT NULL)::bool AS deactivated
FROM users
WHERE id = $1;

-- name: CreateEmailToken :exec
INSERT INTO email_tokens (id, user_id, purpose, token_hash, address, expires_at)
VALUES ($1, $2, $3, $4, $5, $6);
