-- Messages. Owned by the chat module.
-- Only internal/chat may use these queries.
--
-- A message goes to a client through the message_with_reply view, which
-- leaves out messages.search and adds the reply quote. The queries here
-- that skip the view list the same columns. A new messages column goes in
-- each list and in the view; see docs/architecture/messaging.md → Search.

-- name: CreateMessage :one
INSERT INTO messages (id, channel_id, author_id, content, mentions_everyone, mentions_here, reply_to_message_id,
    thread_root_id, in_channel)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id, channel_id, author_id, content, created_at, mentions_everyone, reply_to_message_id, mentions_here, edited_at, thread_root_id, in_channel, deleted_at;

-- name: GetMessage :one
SELECT id, channel_id, author_id, content, created_at, mentions_everyone, reply_to_message_id, mentions_here, edited_at, thread_root_id, in_channel, deleted_at
FROM messages WHERE id = $1;

-- ListMessagesBefore carries the replied-to message's quote (if any) so
-- the client can render it without a second round trip. Only rows that
-- show in the channel: a thread's replies are paged by ListThreadBefore.
-- name: ListMessagesBefore :many
SELECT * FROM message_with_reply m
WHERE m.channel_id = $1
  AND m.in_channel
  AND (sqlc.narg('before_id')::uuid IS NULL OR m.id < sqlc.narg('before_id')::uuid)
ORDER BY m.id DESC
LIMIT $2;

-- ListMessagesAfter is the forward counterpart: the oldest `limit` messages
-- newer than after_id (or from it, when inclusive), oldest-first.
-- name: ListMessagesAfter :many
SELECT * FROM message_with_reply m
WHERE m.channel_id = $1
  AND m.in_channel
  AND (m.id > sqlc.arg('after_id')::uuid OR (sqlc.arg('inclusive')::bool AND m.id = sqlc.arg('after_id')::uuid))
ORDER BY m.id ASC
LIMIT $2;

-- GetMessageWithReply is one message with the reply columns, for the
-- events that resend a message after it changes.
-- name: GetMessageWithReply :one
SELECT * FROM message_with_reply m
WHERE m.id = $1;

-- name: InsertMessageMentions :exec
INSERT INTO message_mentions (message_id, user_id)
SELECT sqlc.arg('message_id')::uuid, unnest(sqlc.arg('user_ids')::uuid[])
ON CONFLICT DO NOTHING;

-- name: ListMentionsForMessages :many
SELECT message_id, user_id FROM message_mentions
WHERE message_id = ANY($1::uuid[]);

-- UpdateMessageContent never writes onto a root kept as a placeholder: no
-- row comes back, even when the placeholder landed after the caller's
-- check.
-- name: UpdateMessageContent :one
UPDATE messages SET content = $2, edited_at = now() WHERE id = $1 AND deleted_at IS NULL
RETURNING id, channel_id, author_id, content, created_at, mentions_everyone, reply_to_message_id, mentions_here, edited_at, thread_root_id, in_channel, deleted_at;

-- name: DeleteMessage :exec
DELETE FROM messages WHERE id = $1;

-- RecomputeChannelLastMessage repoints a channel at its newest remaining
-- message that shows in the channel, after a delete.
-- name: RecomputeChannelLastMessage :exec
UPDATE channels c
SET last_message_id = (SELECT m.id FROM messages m WHERE m.channel_id = c.id AND m.in_channel ORDER BY m.id DESC LIMIT 1)
WHERE c.id = $1;

-- Message retention: top-level messages older than the cutoff id
-- (UUIDv7, so id order is time order), less pinned ones, oldest first. A
-- thread goes by its root's age, so replies are never listed: deleting
-- the root takes them, however recent.
-- name: ListExpiredMessages :many
SELECT m.id, m.channel_id FROM messages m
WHERE m.id < sqlc.arg(cutoff)::uuid
  AND m.thread_root_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM channel_pins p WHERE p.message_id = m.id)
ORDER BY m.id
LIMIT sqlc.arg('limit');

-- CountExpiredMessages is what the sweep would delete: the expired roots
-- and every reply under them.
-- name: CountExpiredMessages :one
WITH expired AS (
    SELECT m.id FROM messages m
    WHERE m.id < sqlc.arg(cutoff)::uuid
      AND m.thread_root_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM channel_pins p WHERE p.message_id = m.id)
)
SELECT ((SELECT count(*) FROM expired)
    + (SELECT count(*) FROM messages r WHERE r.thread_root_id IN (SELECT id FROM expired)))::bigint;

-- CountRepliesUnder counts the replies the cascade will take with these
-- roots.
-- name: CountRepliesUnder :one
SELECT count(*)::bigint FROM messages WHERE thread_root_id = ANY(sqlc.arg(ids)::uuid[]);

-- name: DeleteMessagesByIDs :exec
DELETE FROM messages WHERE id = ANY(sqlc.arg(ids)::uuid[]);
