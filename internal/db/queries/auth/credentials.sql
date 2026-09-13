-- Credentials. Owned by the auth module.
-- Only internal/auth may use these queries.
--
-- Until the contract migration drops sessions, every revocation also clears
-- the matching legacy rows, so rolling back to the previous release can't
-- bring a revoked session back.

-- CreateSession mints a session for a person. A bot never gets one: the
-- insert finds no holder and returns no row.
-- name: CreateSession :one
INSERT INTO credentials (id, holder_id, kind, token_hash, expires_at)
SELECT sqlc.arg(id)::uuid, u.id, 'session', sqlc.arg(token_hash)::bytea, sqlc.arg(expires_at)::timestamptz
FROM users u
WHERE u.id = sqlc.arg(holder_id)::uuid AND u.kind = 'person'
RETURNING id;

-- GetCredentialByTokenHash is the whole of verification: the credential,
-- its holder's role and kind, and its bounds.
-- name: GetCredentialByTokenHash :one
SELECT c.id, c.holder_id, c.kind, c.grants, c.bounded,
       u.role AS holder_role, u.kind AS holder_kind,
       coalesce(array_agg(b.space_id) FILTER (WHERE b.space_id IS NOT NULL), '{}')::uuid[] AS bound_spaces,
       coalesce(array_agg(b.channel_id) FILTER (WHERE b.channel_id IS NOT NULL), '{}')::uuid[] AS bound_channels
FROM credentials c
JOIN users u ON u.id = c.holder_id
LEFT JOIN credential_bounds b ON b.credential_id = c.id
WHERE c.token_hash = $1
  AND (c.expires_at IS NULL OR c.expires_at > now())
  AND u.deactivated_at IS NULL
GROUP BY c.id, u.role, u.kind;

-- name: DeleteCredential :exec
WITH legacy AS (DELETE FROM sessions WHERE sessions.id = $1)
DELETE FROM credentials WHERE credentials.id = $1;

-- DeleteOtherSessions signs a person out everywhere except the calling
-- session (used after a password change).
-- name: DeleteOtherSessions :exec
WITH legacy AS (DELETE FROM sessions WHERE user_id = sqlc.arg(holder_id) AND sessions.id <> sqlc.arg(id))
DELETE FROM credentials
WHERE holder_id = sqlc.arg(holder_id) AND kind = 'session' AND credentials.id <> sqlc.arg(id);

-- DeleteUserCredentials revokes everything an account holds, on
-- deactivation and on an admin password reset.
-- name: DeleteUserCredentials :exec
WITH legacy AS (DELETE FROM sessions WHERE user_id = $1)
DELETE FROM credentials WHERE holder_id = $1;
