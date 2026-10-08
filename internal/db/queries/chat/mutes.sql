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

-- MutedAmong: which of these recipients have muted where something
-- happened, by their own channel, space or thread row. space_id is NULL
-- for a direct message, thread_root_id outside a thread.
-- name: MutedAmong :many
SELECT cm.user_id FROM channel_mutes cm
WHERE cm.channel_id = sqlc.arg('channel_id')::uuid AND cm.user_id = ANY(sqlc.arg('user_ids')::uuid[])
UNION
SELECT sm.user_id FROM space_mutes sm
WHERE sm.space_id = sqlc.narg('space_id')::uuid AND sm.user_id = ANY(sqlc.arg('user_ids')::uuid[])
UNION
SELECT tm.user_id FROM thread_mutes tm
WHERE tm.root_message_id = sqlc.narg('thread_root_id')::uuid AND tm.user_id = ANY(sqlc.arg('user_ids')::uuid[]);
