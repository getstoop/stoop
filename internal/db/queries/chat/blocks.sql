-- User blocks. Owned by the chat module.
-- Only internal/chat may use these queries.

-- name: BlockUser :exec
INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: UnblockUser :execrows
DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2;

-- HasBlocked: has blocker blocked blocked?
-- name: HasBlocked :one
SELECT EXISTS (
    SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2
) AS blocked;

-- BlockedEitherWay: does either of the two block the other?
-- name: BlockedEitherWay :one
SELECT EXISTS (
    SELECT 1 FROM user_blocks
    WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)
) AS blocked;

-- name: ListBlockedUserIDs :many
SELECT blocked_id FROM user_blocks WHERE blocker_id = $1 ORDER BY created_at DESC;

-- BlockersAmong: which of these users have blocked the given user (so a
-- activity item from them is not written).
-- name: BlockersAmong :many
SELECT blocker_id FROM user_blocks
WHERE blocked_id = sqlc.arg(user_id) AND blocker_id = ANY(sqlc.arg(ids)::uuid[]);
