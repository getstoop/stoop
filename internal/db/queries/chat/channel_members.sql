-- Who is in a text channel. Owned by the chat module.
-- Only internal/chat may use these queries.

-- name: IsInChannel :one
SELECT EXISTS (
    SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2
) AS is_in;

-- AddChannelMembers adds the people named who are in the channel's space
-- and not yet in the channel, and returns who that was.
-- name: AddChannelMembers :many
INSERT INTO channel_members (channel_id, space_id, user_id, added_by)
SELECT c.id, c.space_id, sm.user_id, sqlc.narg(added_by)::uuid
FROM channels c
JOIN space_members sm ON sm.space_id = c.space_id
WHERE c.id = sqlc.arg(channel_id)::uuid
  AND sm.user_id = ANY(sqlc.arg(user_ids)::uuid[])
ON CONFLICT DO NOTHING
RETURNING user_id;

-- name: AddEveryoneToChannel :many
INSERT INTO channel_members (channel_id, space_id, user_id, added_by)
SELECT c.id, c.space_id, sm.user_id, sqlc.narg(added_by)::uuid
FROM channels c
JOIN space_members sm ON sm.space_id = c.space_id
WHERE c.id = sqlc.arg(channel_id)::uuid
ON CONFLICT DO NOTHING
RETURNING user_id;

-- name: RemoveChannelMember :execrows
DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2;

-- ListChannelMembers orders as ListSpaceMembers does.
-- name: ListChannelMembers :many
SELECT sm.* FROM space_members sm
JOIN channel_members cm ON cm.space_id = sm.space_id AND cm.user_id = sm.user_id
WHERE cm.channel_id = $1
ORDER BY CASE sm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, sm.joined_at;

-- MarkChannelReadFor moves several people's markers to one message, for
-- people put in a channel who should not find its whole history unread.
-- name: MarkChannelReadFor :exec
INSERT INTO channel_reads (user_id, channel_id, last_read_message_id)
SELECT u.id, sqlc.arg(channel_id)::uuid, sqlc.arg(last_read_message_id)::uuid
FROM unnest(sqlc.arg(user_ids)::uuid[]) AS u(id)
ON CONFLICT (user_id, channel_id) DO UPDATE
SET last_read_message_id = GREATEST(channel_reads.last_read_message_id, EXCLUDED.last_read_message_id),
    updated_at = now();
