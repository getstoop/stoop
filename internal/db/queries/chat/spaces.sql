-- Spaces: the community-level container. Owned by the chat module.
-- Only internal/chat may use these queries.

-- name: CreateSpace :one
INSERT INTO spaces (id, name, owner_id)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetSpace :one
SELECT * FROM spaces WHERE id = $1;

-- ListSpacesByUser also returns the caller's role in each space, whether
-- any channel there has messages newer than their read marker, and their
-- own mute for the space. has_unread does not know about space mutes; the
-- client derives the effective state from both flags.
-- name: ListSpacesByUser :many
SELECT sqlc.embed(s), m.role AS my_role,
    EXISTS (SELECT 1 FROM space_mutes sm WHERE sm.space_id = s.id AND sm.user_id = m.user_id) AS muted,
    EXISTS (
        SELECT 1 FROM channels c
        LEFT JOIN channel_reads r ON r.channel_id = c.id AND r.user_id = m.user_id
        WHERE c.space_id = s.id
          AND c.last_message_id IS NOT NULL
          AND (r.last_read_message_id IS NULL OR c.last_message_id > r.last_read_message_id)
          AND NOT EXISTS (SELECT 1 FROM channel_mutes cm WHERE cm.channel_id = c.id AND cm.user_id = m.user_id)
    ) AS has_unread
FROM spaces s
JOIN space_members m ON m.space_id = s.id
WHERE m.user_id = $1
ORDER BY m.joined_at;

-- name: UpdateSpaceOwner :exec
UPDATE spaces SET owner_id = $2 WHERE id = $1;

-- Every column here is COALESCE'd so an unset parameter leaves it alone,
-- except default_channel_id: it is nullable, so NULL is a value a caller
-- can mean ("go back to the first channel") and COALESCE could not tell
-- that apart from "don't touch it". A separate boolean says whether to
-- write the column at all.
-- name: UpdateSpaceSettings :one
UPDATE spaces
SET name = COALESCE(sqlc.narg('name'), name),
    members_can_invite = COALESCE(sqlc.narg('members_can_invite'), members_can_invite),
    description = COALESCE(sqlc.narg('description'), description),
    welcome = COALESCE(sqlc.narg('welcome'), welcome),
    default_channel_id = CASE WHEN sqlc.arg('set_default_channel')::boolean
        THEN sqlc.narg('default_channel_id')::uuid
        ELSE default_channel_id END
WHERE id = $1
RETURNING *;

-- Clears the landing channel, but only while it is still the channel
-- being deleted. Returning a row is how the caller learns it cleared
-- anything: reading the space and comparing would leave a window for
-- another admin's edit between the read and the delete. The UPDATE takes
-- the space's row lock, so a concurrent UpdateSpaceSettings waits.
-- name: ClearSpaceDefaultChannel :one
UPDATE spaces SET default_channel_id = NULL
WHERE id = sqlc.arg('id')::uuid
  AND default_channel_id = sqlc.arg('channel_id')::uuid
RETURNING *;

-- name: DeleteSpace :exec
DELETE FROM spaces WHERE id = $1;

-- The icon pointer is replaced in a transaction: lock the row and read the
-- current file id, then update, so the caller can delete the old blob
-- without racing another upload.
-- name: GetSpaceIconForUpdate :one
SELECT icon_file_id FROM spaces WHERE id = $1 FOR UPDATE;

-- name: SetSpaceIcon :exec
UPDATE spaces SET icon_file_id = sqlc.narg('icon_file_id') WHERE id = $1;
