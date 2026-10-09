-- Account email addresses on users. Owned by the auth module.
-- Only internal/auth may use these queries.

-- name: SetPendingEmail :exec
UPDATE users SET pending_email = sqlc.arg(address)::citext, pending_email_at = now()
WHERE id = sqlc.arg(id)::uuid;

-- name: ClearPendingEmail :exec
UPDATE users SET pending_email = NULL, pending_email_at = NULL WHERE id = $1;

-- ClearUserEmail drops both addresses, on removal and on deletion.
-- name: ClearUserEmail :exec
UPDATE users
SET email = NULL, email_confirmed_at = NULL, pending_email = NULL, pending_email_at = NULL
WHERE id = $1;

-- ConfirmPendingEmail makes the pending address the account's address.
-- name: ConfirmPendingEmail :exec
UPDATE users
SET email = pending_email, email_confirmed_at = now(), pending_email = NULL, pending_email_at = NULL
WHERE id = $1 AND pending_email IS NOT NULL;

-- EmailConfirmedElsewhere: another account already holds the address.
-- name: EmailConfirmedElsewhere :one
SELECT EXISTS (
    SELECT 1 FROM users WHERE email = sqlc.arg(address)::citext AND id <> sqlc.arg(user_id)::uuid
);

-- AdoptProviderEmail takes a provider's verified address as confirmed,
-- unless another account holds it.
-- name: AdoptProviderEmail :exec
UPDATE users SET email = sqlc.arg(address)::citext, email_confirmed_at = now()
WHERE id = sqlc.arg(id)::uuid
  AND NOT EXISTS (SELECT 1 FROM users other WHERE other.email = sqlc.arg(address)::citext);
