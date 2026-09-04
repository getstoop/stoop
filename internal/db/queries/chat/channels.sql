-- Channels within a space. Owned by the chat module.
-- Only internal/chat may use these queries.

-- name: CreateChannel :one
INSERT INTO channels (id, space_id, name, kind, position)
VALUES (sqlc.arg(id), sqlc.arg(space_id)::uuid, sqlc.arg(name), sqlc.arg(kind), sqlc.arg(position))
RETURNING *;

-- name: GetChannel :one
SELECT * FROM channels WHERE id = $1;

-- ListChannelsBySpace includes the caller's read marker, how many
-- messages are newer than it (all of them if they've never opened it),
-- and whether they muted it.
-- name: ListChannelsBySpace :many
SELECT sqlc.embed(c), r.last_read_message_id,
    EXISTS (SELECT 1 FROM channel_mutes cm WHERE cm.channel_id = c.id AND cm.user_id = sqlc.arg(user_id)) AS muted,
    (SELECT count(*) FROM messages m
     WHERE m.channel_id = c.id
       AND (r.last_read_message_id IS NULL OR m.id > r.last_read_message_id)) AS unread_count
FROM channels c
LEFT JOIN channel_reads r ON r.channel_id = c.id AND r.user_id = sqlc.arg(user_id)
WHERE c.space_id = sqlc.arg(space_id)::uuid
ORDER BY c.position, c.created_at;

-- name: SetChannelLastMessage :exec
UPDATE channels SET last_message_id = $2 WHERE id = $1;

-- UpsertChannelRead moves a user's marker forward; it never goes backwards
-- (UUIDv7 IDs are time-ordered, so GREATEST is "newest").
-- name: UpsertChannelRead :exec
INSERT INTO channel_reads (user_id, channel_id, last_read_message_id)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, channel_id) DO UPDATE
SET last_read_message_id = GREATEST(channel_reads.last_read_message_id, EXCLUDED.last_read_message_id),
    updated_at = now();

-- name: UpdateChannel :one
UPDATE channels
SET name = COALESCE(sqlc.narg('name'), name),
    position = COALESCE(sqlc.narg('position'), position),
    topic = COALESCE(sqlc.narg('topic'), topic)
WHERE id = $1
RETURNING *;

-- name: DeleteChannel :exec
DELETE FROM channels WHERE id = $1;

-- name: CountChannelsInSpace :one
SELECT count(*) FROM channels WHERE space_id = sqlc.arg(space_id)::uuid;

-- name: SetChannelPosition :exec
UPDATE channels SET position = sqlc.arg(position) WHERE id = sqlc.arg(id) AND space_id = sqlc.arg(space_id)::uuid;

-- ListChannelIDsByKind lists a space's channels of one kind. Voice channel
-- ids are also their LiveKit room names, so this is what a kick has to
-- clear someone out of.
-- name: ListChannelIDsByKind :many
SELECT id FROM channels WHERE space_id = sqlc.arg(space_id)::uuid AND kind = sqlc.arg(kind)
ORDER BY position, created_at;
