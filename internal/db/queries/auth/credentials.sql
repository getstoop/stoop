-- Credentials. Owned by the auth module.
-- Only internal/auth may use these queries.
--
-- Until the contract migration drops sessions, every revocation also clears
-- the matching legacy rows, so rolling back to the previous release can't
-- bring a revoked session back. Every revocation returns what it removed,
-- so auth can tell the gateway to close the sockets opened with it.

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
SELECT c.id, c.holder_id, c.kind, c.grants, c.bounded, c.last_used_at,
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

-- name: DeleteCredential :many
WITH legacy AS (DELETE FROM sessions WHERE sessions.id = $1)
DELETE FROM credentials WHERE credentials.id = $1
RETURNING id, holder_id;

-- DeleteOtherSessions signs a person out everywhere except the calling
-- session (used after a password change).
-- name: DeleteOtherSessions :many
WITH legacy AS (DELETE FROM sessions WHERE user_id = sqlc.arg(holder_id) AND sessions.id <> sqlc.arg(id))
DELETE FROM credentials
WHERE holder_id = sqlc.arg(holder_id) AND kind = 'session' AND credentials.id <> sqlc.arg(id)
RETURNING id, holder_id;

-- DeleteUserCredentials revokes everything an account holds, on
-- deactivation and on an admin password reset.
-- name: DeleteUserCredentials :many
WITH legacy AS (DELETE FROM sessions WHERE user_id = $1)
DELETE FROM credentials WHERE holder_id = $1
RETURNING id, holder_id;

-- TouchCredential records a token's use. The caller throttles it.
-- name: TouchCredential :exec
UPDATE credentials SET last_used_at = now() WHERE id = $1;

-- name: CreatePersonalToken :one
INSERT INTO credentials (id, holder_id, kind, token_hash, name, grants, bounded, created_by, expires_at, hint)
VALUES (sqlc.arg(id)::uuid, sqlc.arg(holder_id)::uuid, 'personal_token', sqlc.arg(token_hash)::bytea,
        sqlc.arg(name)::text, sqlc.arg(grants)::text[], sqlc.arg(bounded)::boolean, sqlc.arg(holder_id)::uuid,
        sqlc.narg(expires_at)::timestamptz, sqlc.arg(hint)::text)
RETURNING *;

-- name: AddCredentialSpaceBound :exec
INSERT INTO credential_bounds (credential_id, space_id)
VALUES (sqlc.arg(credential_id)::uuid, sqlc.arg(space_id)::uuid);

-- ListPersonalTokens is one account's tokens, expired ones included.
-- name: ListPersonalTokens :many
SELECT c.id, c.name, c.grants, c.bounded, c.created_at, c.last_used_at, c.expires_at, c.hint,
       coalesce(array_agg(b.space_id) FILTER (WHERE b.space_id IS NOT NULL), '{}')::uuid[] AS bound_spaces
FROM credentials c
LEFT JOIN credential_bounds b ON b.credential_id = c.id
WHERE c.holder_id = $1 AND c.kind = 'personal_token'
GROUP BY c.id
ORDER BY c.created_at DESC;

-- name: DeletePersonalToken :many
DELETE FROM credentials
WHERE id = sqlc.arg(id)::uuid AND holder_id = sqlc.arg(holder_id)::uuid AND kind = 'personal_token'
RETURNING id, holder_id;

-- name: DeleteUserPersonalTokens :many
DELETE FROM credentials WHERE holder_id = $1 AND kind = 'personal_token'
RETURNING id, holder_id;

-- name: CountPersonalTokensByHolder :many
SELECT holder_id, count(*) AS n FROM credentials WHERE kind = 'personal_token' GROUP BY holder_id;

-- SweepCredentials deletes sessions once they expire, and other credentials
-- once they expired before expired_before, so a list can still explain a
-- recently expired token.
-- name: SweepCredentials :many
WITH legacy AS (DELETE FROM sessions WHERE sessions.expires_at <= now())
DELETE FROM credentials
WHERE (kind = 'session' AND expires_at <= now())
   OR (kind <> 'session' AND expires_at <= sqlc.arg(expired_before)::timestamptz)
RETURNING id, holder_id;
