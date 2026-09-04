-- Space bans. Owned by the chat module.
-- Only internal/chat may use these queries.

-- name: BanUser :exec
INSERT INTO space_bans (space_id, user_id, banned_by, reason)
VALUES ($1, $2, $3, $4)
ON CONFLICT (space_id, user_id) DO UPDATE
SET banned_by = EXCLUDED.banned_by, reason = EXCLUDED.reason, created_at = now();

-- name: UnbanUser :execrows
DELETE FROM space_bans WHERE space_id = $1 AND user_id = $2;

-- name: IsBanned :one
SELECT EXISTS (
    SELECT 1 FROM space_bans WHERE space_id = $1 AND user_id = $2
) AS banned;

-- name: ListBans :many
SELECT * FROM space_bans WHERE space_id = $1 ORDER BY created_at DESC;
