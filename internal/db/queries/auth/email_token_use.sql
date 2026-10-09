-- Using and clearing email link tokens. Owned by the auth module.
-- Only internal/auth may use these queries.

-- EmailTokenOwner is the account a token belongs to, unlocked: confirming
-- locks that account first (LockUserEmail), then the token.
-- name: EmailTokenOwner :one
SELECT user_id FROM email_tokens
WHERE token_hash = sqlc.arg(token_hash)::bytea AND purpose = sqlc.arg(purpose)::text;

-- GetConfirmableEmailToken is a live token whose address is still the
-- account's pending one, on an active account. The token is locked; the
-- account already is.
-- name: GetConfirmableEmailToken :one
SELECT t.id, t.user_id, t.address, u.email AS previous_email
FROM email_tokens t
JOIN users u ON u.id = t.user_id
WHERE t.token_hash = sqlc.arg(token_hash)::bytea
  AND t.purpose = sqlc.arg(purpose)::text
  AND t.used_at IS NULL
  AND t.expires_at > now()
  AND u.deactivated_at IS NULL
  AND u.pending_email = t.address
FOR UPDATE OF t;

-- name: MarkEmailTokenUsed :exec
UPDATE email_tokens SET used_at = now() WHERE id = $1;

-- name: DeleteOtherEmailTokens :exec
DELETE FROM email_tokens
WHERE user_id = sqlc.arg(user_id)::uuid AND purpose = sqlc.arg(purpose)::text AND id <> sqlc.arg(keep_id)::uuid;

-- DeleteOlderEmailTokens retires the links made before keep_id, never
-- after it: of two links sent at once, the newer one survives.
-- name: DeleteOlderEmailTokens :exec
DELETE FROM email_tokens old
USING email_tokens kept
WHERE kept.id = sqlc.arg(keep_id)::uuid
  AND old.user_id = kept.user_id AND old.purpose = kept.purpose
  AND (old.created_at, old.id) < (kept.created_at, kept.id);

-- name: DeleteUserEmailTokens :exec
DELETE FROM email_tokens WHERE user_id = sqlc.arg(user_id)::uuid AND purpose = sqlc.arg(purpose)::text;

-- name: DeleteAllUserEmailTokens :exec
DELETE FROM email_tokens WHERE user_id = $1;

-- SweepEmailTokens deletes tokens that expired or were used before the
-- cutoff.
-- name: SweepEmailTokens :execrows
DELETE FROM email_tokens
WHERE expires_at <= sqlc.arg(before)::timestamptz OR used_at <= sqlc.arg(before)::timestamptz;
