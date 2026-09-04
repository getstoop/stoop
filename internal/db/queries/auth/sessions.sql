-- Sessions. Owned by the auth module.
-- Only internal/auth may use these queries.

-- name: CreateSession :one
INSERT INTO sessions (id, user_id, token_hash, expires_at)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetSessionByTokenHash :one
SELECT s.id, s.user_id, s.expires_at, u.role AS user_role
FROM sessions s
JOIN users u ON u.id = s.user_id
WHERE s.token_hash = $1 AND s.expires_at > now() AND u.deactivated_at IS NULL;

-- name: DeleteSession :exec
DELETE FROM sessions WHERE id = $1;

-- name: DeleteExpiredSessions :exec
DELETE FROM sessions WHERE expires_at <= now();

-- DeleteOtherSessions signs a user out everywhere except the calling
-- session (used after a password change).
-- name: DeleteOtherSessions :exec
DELETE FROM sessions WHERE user_id = $1 AND id <> $2;

-- name: DeleteUserSessions :exec
DELETE FROM sessions WHERE user_id = $1;
