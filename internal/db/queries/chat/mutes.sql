-- Per-channel and per-space mutes. Owned by the chat module.
-- Only internal/chat may use these queries.

-- name: MuteChannel :exec
INSERT INTO channel_mutes (user_id, channel_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: UnmuteChannel :exec
DELETE FROM channel_mutes WHERE user_id = $1 AND channel_id = $2;

-- name: MuteSpace :exec
INSERT INTO space_mutes (user_id, space_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: UnmuteSpace :exec
DELETE FROM space_mutes WHERE user_id = $1 AND space_id = $2;

-- IsMutedFor answers, for one recipient, whether where something
-- happened is effectively muted for them: their own channel row or
-- their own space row. space_id is NULL for a direct message.
-- name: IsMutedFor :one
SELECT (EXISTS (SELECT 1 FROM channel_mutes cm WHERE cm.user_id = sqlc.arg('user_id')::uuid AND cm.channel_id = sqlc.arg('channel_id')::uuid)
    OR EXISTS (SELECT 1 FROM space_mutes sm WHERE sm.user_id = sqlc.arg('user_id')::uuid AND sm.space_id = sqlc.narg('space_id')::uuid))::bool;
