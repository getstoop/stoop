-- Messages. Owned by the chat module.
-- Only internal/chat may use these queries.
--
-- A query that returns a message lists its columns, leaving out
-- messages.search. Keep the lists identical, here and in pins.sql and
-- search.sql; see docs/architecture/messaging.md → Search.

-- name: CreateMessage :one
INSERT INTO messages (id, channel_id, author_id, content, mentions_everyone, mentions_here, reply_to_message_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, channel_id, author_id, content, created_at, mentions_everyone, reply_to_message_id, mentions_here, edited_at;

-- name: GetMessage :one
SELECT id, channel_id, author_id, content, created_at, mentions_everyone, reply_to_message_id, mentions_here, edited_at
FROM messages WHERE id = $1;

-- ListMessagesBefore joins the replied-to message (if any) so the client
-- can render a quote without a second round trip.
-- name: ListMessagesBefore :many
SELECT m.id, m.channel_id, m.author_id, m.content, m.created_at, m.mentions_everyone, m.reply_to_message_id, m.mentions_here, m.edited_at,
    p.author_id AS reply_author_id, p.content AS reply_content,
    COALESCE((SELECT a.file_id::text FROM message_attachments a WHERE a.message_id = p.id ORDER BY a.position LIMIT 1), '')::text AS reply_first_file_id
FROM messages m
LEFT JOIN messages p ON p.id = m.reply_to_message_id
WHERE m.channel_id = $1
  AND (sqlc.narg('before_id')::uuid IS NULL OR m.id < sqlc.narg('before_id')::uuid)
ORDER BY m.id DESC
LIMIT $2;

-- ListMessagesAfter is the forward counterpart: the oldest `limit` messages
-- newer than after_id (or from it, when inclusive), oldest-first.
-- name: ListMessagesAfter :many
SELECT m.id, m.channel_id, m.author_id, m.content, m.created_at, m.mentions_everyone, m.reply_to_message_id, m.mentions_here, m.edited_at,
    p.author_id AS reply_author_id, p.content AS reply_content,
    COALESCE((SELECT a.file_id::text FROM message_attachments a WHERE a.message_id = p.id ORDER BY a.position LIMIT 1), '')::text AS reply_first_file_id
FROM messages m
LEFT JOIN messages p ON p.id = m.reply_to_message_id
WHERE m.channel_id = $1
  AND (m.id > sqlc.arg('after_id')::uuid OR (sqlc.arg('inclusive')::bool AND m.id = sqlc.arg('after_id')::uuid))
ORDER BY m.id ASC
LIMIT $2;

-- name: InsertMessageMention :exec
INSERT INTO message_mentions (message_id, user_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: ListMentionsForMessages :many
SELECT message_id, user_id FROM message_mentions
WHERE message_id = ANY($1::uuid[]);

-- name: UpdateMessageContent :one
UPDATE messages SET content = $2, edited_at = now() WHERE id = $1
RETURNING id, channel_id, author_id, content, created_at, mentions_everyone, reply_to_message_id, mentions_here, edited_at;

-- name: DeleteMessage :exec
DELETE FROM messages WHERE id = $1;

-- RecomputeChannelLastMessage repoints a channel at its newest remaining
-- message after a delete.
-- name: RecomputeChannelLastMessage :exec
UPDATE channels c
SET last_message_id = (SELECT m.id FROM messages m WHERE m.channel_id = c.id ORDER BY m.id DESC LIMIT 1)
WHERE c.id = $1;

-- Message retention: messages older than the cutoff id (UUIDv7, so id
-- order is time order), less pinned ones, oldest first.
-- name: ListExpiredMessages :many
SELECT m.id, m.channel_id FROM messages m
WHERE m.id < sqlc.arg(cutoff)::uuid
  AND NOT EXISTS (SELECT 1 FROM channel_pins p WHERE p.message_id = m.id)
ORDER BY m.id
LIMIT sqlc.arg('limit');

-- name: CountExpiredMessages :one
SELECT count(*)::bigint FROM messages m
WHERE m.id < sqlc.arg(cutoff)::uuid
  AND NOT EXISTS (SELECT 1 FROM channel_pins p WHERE p.message_id = m.id);

-- name: DeleteMessagesByIDs :exec
DELETE FROM messages WHERE id = ANY(sqlc.arg(ids)::uuid[]);
