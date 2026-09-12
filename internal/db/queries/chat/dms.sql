-- Direct messages: channels with no space, participants in dm_members.
-- Owned by the chat module. Only internal/chat may use these queries.

-- OpenDMChannel creates the channel for a dm_key or returns the existing
-- one: the no-op ON CONFLICT update makes RETURNING yield the row either
-- way, so two people opening the same conversation at once get the same
-- channel. The key is every participant sorted and joined, so this holds
-- for a pair and for a group alike.
-- name: OpenDMChannel :one
INSERT INTO channels (id, space_id, name, kind, dm_key)
VALUES ($1, NULL, '', 3, $2)
ON CONFLICT (dm_key) DO UPDATE SET dm_key = EXCLUDED.dm_key
RETURNING *;

-- name: AddDMMember :exec
INSERT INTO dm_members (channel_id, user_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: IsDMMember :one
SELECT EXISTS (
    SELECT 1 FROM dm_members WHERE channel_id = $1 AND user_id = $2
) AS is_member;

-- name: ListDMMembers :many
SELECT user_id FROM dm_members WHERE channel_id = $1 ORDER BY user_id;

-- name: ListDMMembersForChannels :many
SELECT channel_id, user_id FROM dm_members
WHERE channel_id = ANY(sqlc.arg('channel_ids')::uuid[])
ORDER BY channel_id, user_id;

-- ListDMChannelsByUser is the caller's DM list, newest activity first,
-- with the same read marker and unread count ListChannelsBySpace gives.
-- name: ListDMChannelsByUser :many
SELECT sqlc.embed(c), r.last_read_message_id,
    EXISTS (SELECT 1 FROM channel_mutes cm WHERE cm.channel_id = c.id AND cm.user_id = sqlc.arg(user_id)) AS muted,
    (SELECT count(*) FROM messages m
     WHERE m.channel_id = c.id
       AND (r.last_read_message_id IS NULL OR m.id > r.last_read_message_id)) AS unread_count
FROM channels c
JOIN dm_members d ON d.channel_id = c.id AND d.user_id = sqlc.arg(user_id)
LEFT JOIN channel_reads r ON r.channel_id = c.id AND r.user_id = sqlc.arg(user_id)
WHERE c.kind = 3
  -- A conversation holding somebody you blocked is not yours to see.
  AND NOT EXISTS (
    SELECT 1 FROM dm_members o
    JOIN user_blocks b ON b.blocked_id = o.user_id AND b.blocker_id = sqlc.arg(user_id)
    WHERE o.channel_id = c.id AND o.user_id <> sqlc.arg(user_id)
  )
ORDER BY c.last_message_id DESC NULLS LAST, c.created_at DESC;

-- SharesSpace: do two users belong to at least one common space?
-- name: SharesSpace :one
SELECT EXISTS (
    SELECT 1 FROM space_members a
    JOIN space_members b ON b.space_id = a.space_id
    WHERE a.user_id = $1 AND b.user_id = $2
) AS shares;

-- SharesSpaceAmong: which of these users share at least one space with the
-- caller. The caller may message exactly those, so a short list back means
-- somebody in the request is out of reach.
-- name: SharesSpaceAmong :many
SELECT DISTINCT b.user_id FROM space_members a
JOIN space_members b ON b.space_id = a.space_id
WHERE a.user_id = sqlc.arg(user_id) AND b.user_id = ANY(sqlc.arg(ids)::uuid[]);

-- BlockedAmong: which of these users block, or are blocked by, the given
-- user. One round trip instead of a pair check each.
-- name: BlockedAmong :many
SELECT DISTINCT (CASE WHEN blocker_id = sqlc.arg(user_id) THEN blocked_id ELSE blocker_id END)::uuid AS user_id
FROM user_blocks
WHERE (blocker_id = sqlc.arg(user_id) AND blocked_id = ANY(sqlc.arg(ids)::uuid[]))
   OR (blocked_id = sqlc.arg(user_id) AND blocker_id = ANY(sqlc.arg(ids)::uuid[]));

-- ListDMCandidates: everyone the caller may start a conversation with —
-- the people they share a space with, minus blocks in either direction.
-- name: ListDMCandidates :many
SELECT DISTINCT o.user_id FROM space_members me
JOIN space_members o ON o.space_id = me.space_id AND o.user_id <> me.user_id
WHERE me.user_id = sqlc.arg(user_id)
  AND NOT EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id = sqlc.arg(user_id) AND b.blocked_id = o.user_id)
       OR (b.blocked_id = sqlc.arg(user_id) AND b.blocker_id = o.user_id)
  )
LIMIT sqlc.arg(lim);
