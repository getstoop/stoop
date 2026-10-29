-- Channels within a space. Owned by the chat module.
-- Only internal/chat may use these queries.

-- name: CreateChannel :one
INSERT INTO channels (id, space_id, name, kind, position, private)
VALUES (sqlc.arg(id), sqlc.arg(space_id)::uuid, sqlc.arg(name), sqlc.arg(kind), sqlc.arg(position), sqlc.arg(private))
RETURNING *;

-- name: GetChannel :one
SELECT * FROM channels WHERE id = $1;

-- ListChannelsBySpace is the space's public channels and the private
-- ones the caller is in, with the caller's read marker, how many shown
-- messages are newer than it (all of them if they've never opened it; a
-- tombstone counts only as the placeholder of a thread with live
-- replies), and whether they muted it.
-- name: ListChannelsBySpace :many
SELECT sqlc.embed(c), r.last_read_message_id,
    EXISTS (SELECT 1 FROM channel_mutes cm WHERE cm.channel_id = c.id AND cm.user_id = sqlc.arg(user_id)) AS muted,
    (SELECT count(*) FROM messages m
     WHERE m.channel_id = c.id AND m.in_channel
       AND (m.deleted_at IS NULL OR EXISTS (SELECT 1 FROM threads t WHERE t.root_message_id = m.id))
       AND (r.last_read_message_id IS NULL OR m.id > r.last_read_message_id)) AS unread_count
FROM channels c
LEFT JOIN channel_reads r ON r.channel_id = c.id AND r.user_id = sqlc.arg(user_id)
WHERE c.space_id = sqlc.arg(space_id)::uuid
  AND EXISTS (SELECT 1 FROM channel_readers cr WHERE cr.channel_id = c.id AND cr.user_id = sqlc.arg(user_id))
ORDER BY c.position, c.created_at;

-- name: SetChannelLastMessage :exec
UPDATE channels SET last_message_id = $2 WHERE id = $1;

-- NextChannelSeq takes the next position in the channel log, and with it
-- the channel row until the transaction ends: message writes in one
-- channel commit one at a time, so "next" is exact. A transaction that
-- writes message rows takes this (or LockChannel) before anything else
-- (internal/chat/seq.go).
-- name: NextChannelSeq :one
UPDATE channels SET seq = seq + 1 WHERE id = $1 RETURNING seq;

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
    topic = COALESCE(sqlc.narg('topic'), topic),
    post_policy = COALESCE(sqlc.narg('post_policy'), post_policy)
WHERE id = $1
RETURNING *;

-- LockChannel holds a channel's row until the transaction ends, which
-- makes anything that adds a row pointing at it wait.
-- name: LockChannel :one
SELECT id FROM channels WHERE id = $1 FOR UPDATE;

-- ShareChannel is LockChannel for a transaction that only reads the
-- channel's messages but writes rows a writer there also takes (a read
-- marker and its activity): it waits for the writers and they for it,
-- while readers don't wait for one another.
-- name: ShareChannel :one
SELECT id FROM channels WHERE id = $1 FOR SHARE;

-- name: DeleteChannel :exec
DELETE FROM channels WHERE id = $1;

-- CountPublicChannelsInSpace is how many channels every member sees:
-- private ones are left out, and voice channels (kind 2) when they are
-- hidden.
-- name: CountPublicChannelsInSpace :one
SELECT count(*) FROM channels
WHERE space_id = sqlc.arg(space_id)::uuid AND NOT private
  AND (sqlc.arg(with_voice)::bool OR kind <> 2);

-- name: SetChannelPosition :exec
UPDATE channels SET position = sqlc.arg(position) WHERE id = sqlc.arg(id) AND space_id = sqlc.arg(space_id)::uuid;

-- ListChannelIDsByKind lists a space's channels of one kind. Voice channel
-- ids are also their LiveKit room names, so this is what a kick has to
-- clear someone out of.
-- name: ListChannelIDsByKind :many
SELECT id FROM channels WHERE space_id = sqlc.arg(space_id)::uuid AND kind = sqlc.arg(kind)
ORDER BY position, created_at;

-- ListLinkableChannelsByIDs is which of a message's channel tokens name a
-- public text channel of its channel's space.
-- name: ListLinkableChannelsByIDs :many
SELECT id, name FROM channels
WHERE space_id = sqlc.arg(space_id)::uuid AND id = ANY (sqlc.arg(ids)::uuid[])
  AND NOT private AND kind = 1;

-- ListChannelNamesByIDs is the current names behind channel tokens, for
-- previews: public text channels only, as a kept link names, since a
-- message saved before links were checked can hold any channel's ID.
-- name: ListChannelNamesByIDs :many
SELECT id, name FROM channels
WHERE id = ANY (sqlc.arg(ids)::uuid[]) AND NOT private AND kind = 1;
