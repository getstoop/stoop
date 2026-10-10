-- Password reset by email. Owned by the auth module.
-- Only internal/auth may use these queries.

-- PasswordResetAccount is the account whose confirmed address this is.
-- name: PasswordResetAccount :one
SELECT id, role, kind, (deactivated_at IS NOT NULL)::bool AS deactivated
FROM users
WHERE email = sqlc.arg(address)::citext;

-- GetPasswordResetToken is a live reset link whose address is still the
-- account's confirmed one, on an active person's account.
-- name: GetPasswordResetToken :one
SELECT t.id, t.user_id, u.username
FROM email_tokens t
JOIN users u ON u.id = t.user_id
WHERE t.token_hash = sqlc.arg(token_hash)::bytea
  AND t.purpose = 'reset_password'
  AND t.used_at IS NULL
  AND t.expires_at > now()
  AND u.deactivated_at IS NULL
  AND u.kind = 'person'
  AND u.email = t.address;

-- LockPasswordResetToken is GetPasswordResetToken with the link locked;
-- the account already is (LockUserEmail).
-- name: LockPasswordResetToken :one
SELECT t.id, t.user_id, u.username
FROM email_tokens t
JOIN users u ON u.id = t.user_id
WHERE t.token_hash = sqlc.arg(token_hash)::bytea
  AND t.purpose = 'reset_password'
  AND t.used_at IS NULL
  AND t.expires_at > now()
  AND u.deactivated_at IS NULL
  AND u.kind = 'person'
  AND u.email = t.address
FOR UPDATE OF t;
