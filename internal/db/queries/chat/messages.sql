-- Messages. Owned by the chat module.
-- Only internal/chat may use these queries.
--
-- A message goes to a client through the message_with_reply view, which
-- leaves out messages.search and adds the reply quote. The queries here
-- that skip the view list the same columns. A new messages column goes in
-- each list and in the view; see docs/architecture/messaging.md → Search.

-- name: CreateMessage :one
INSERT INTO messages (id, channel_id, author_id, content, mentions_entire_channel, mentions_here, reply_to_message_id,
    thread_root_id, in_channel, seq)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, sqlc.arg(seq)::bigint)
RETURNING id, channel_id, author_id, content, created_at, mentions_entire_channel, reply_to_message_id, mentions_here, edited_at, thread_root_id, in_channel, deleted_at, seq;

-- GetMessage is the message an RPC starts from, so it finds only what a
-- reader is shown: a live message, or a deleted root whose thread still
-- has live replies (kept as a placeholder). Any other tombstone is not
-- found, as a hard-deleted message was.
-- name: GetMessage :one
SELECT id, channel_id, author_id, content, created_at, mentions_entire_channel, reply_to_message_id, mentions_here, edited_at, thread_root_id, in_channel, deleted_at, seq
FROM messages m
WHERE id = $1
  AND (m.deleted_at IS NULL OR EXISTS (SELECT 1 FROM threads t WHERE t.root_message_id = m.id));

-- ListMessagesBefore carries the replied-to message's quote (if any) so
-- the client can render it without a second round trip. Only rows that
-- show in the channel: a thread's replies are paged by ListThreadBefore,
-- and a tombstone shows only as the placeholder of a thread with live
-- replies (the threads row exists while there are any).
-- name: ListMessagesBefore :many
SELECT * FROM message_with_reply m
WHERE m.channel_id = $1
  AND m.in_channel
  AND (m.deleted_at IS NULL OR m.thread_reply_count > 0)
  AND (sqlc.narg('before_id')::uuid IS NULL OR m.id < sqlc.narg('before_id')::uuid)
ORDER BY m.id DESC
LIMIT $2;

-- ListMessagesAfter is the forward counterpart: the oldest `limit` messages
-- newer than after_id (or from it, when inclusive), oldest-first.
-- name: ListMessagesAfter :many
SELECT * FROM message_with_reply m
WHERE m.channel_id = $1
  AND m.in_channel
  AND (m.deleted_at IS NULL OR m.thread_reply_count > 0)
  AND (m.id > sqlc.arg('after_id')::uuid OR (sqlc.arg('inclusive')::bool AND m.id = sqlc.arg('after_id')::uuid))
ORDER BY m.id ASC
LIMIT $2;

-- ListMessageChanges is the channel log from a position: every row stamped
-- above since_seq, in seq order, for ListChanges. Deliberately no shown
-- filter: a tombstone and a thread reply are changes the client applies
-- to what it holds, so every row comes back.
-- name: ListMessageChanges :many
SELECT * FROM message_with_reply m
WHERE m.channel_id = $1
  AND m.seq > sqlc.arg(since_seq)::bigint
ORDER BY m.seq
LIMIT sqlc.arg('limit');

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
RETURNING id, channel_id, author_id, content, created_at, mentions_entire_channel, reply_to_message_id, mentions_here, edited_at, thread_root_id, in_channel, deleted_at, seq;

-- StampMessageSeq records the channel log position a row last changed at
-- (NextChannelSeq in channels.sql); no row means the message is gone.
-- name: StampMessageSeq :execrows
UPDATE messages SET seq = sqlc.arg(seq)::bigint WHERE id = sqlc.arg(id);

-- StampLiveMessageSeq is StampMessageSeq for a write that means nothing
-- on a tombstone (a link preview arriving): no row means the message was
-- deleted meanwhile.
-- name: StampLiveMessageSeq :execrows
UPDATE messages SET seq = sqlc.arg(seq)::bigint WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- TombstoneMessage is the one way a message is deleted
-- (internal/chat/tombstones.go): the row stays with deleted_at set and no
-- text (the search column follows), and what a hard delete used to
-- cascade goes with it. reply_to_message_id, thread_root_id and
-- in_channel stay. No row means it was a tombstone already. Its files are
-- deleted through the port afterwards.
-- name: TombstoneMessage :execrows
WITH attachments AS (DELETE FROM message_attachments WHERE message_id = sqlc.arg(id)::uuid),
links AS (DELETE FROM message_links WHERE message_id = sqlc.arg(id)::uuid),
reactions AS (DELETE FROM message_reactions WHERE message_id = sqlc.arg(id)::uuid),
mentions AS (DELETE FROM message_mentions WHERE message_id = sqlc.arg(id)::uuid),
pins AS (DELETE FROM channel_pins WHERE message_id = sqlc.arg(id)::uuid),
activity AS (DELETE FROM activity_items WHERE message_id = sqlc.arg(id)::uuid)
UPDATE messages SET content = '', mentions_entire_channel = false, mentions_here = false,
    edited_at = NULL, deleted_at = now()
WHERE id = sqlc.arg(id)::uuid AND deleted_at IS NULL;

-- RecomputeChannelLastMessage repoints a channel at its newest message
-- that shows in the channel, after a delete: not a tombstone, unless it
-- is the placeholder of a thread with live replies.
-- name: RecomputeChannelLastMessage :exec
UPDATE channels c
SET last_message_id = (
    SELECT m.id FROM messages m
    WHERE m.channel_id = c.id AND m.in_channel
      AND (m.deleted_at IS NULL OR EXISTS (SELECT 1 FROM threads t WHERE t.root_message_id = m.id))
    ORDER BY m.id DESC LIMIT 1)
WHERE c.id = $1;

-- Message retention: top-level messages older than the cutoff id
-- (UUIDv7, so id order is time order), less pinned ones, oldest first,
-- tombstones included. A thread goes by its root's age, so replies are
-- never listed: deleting the root takes them, however recent.
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

-- DeleteExpiredMessages hard-deletes these roots and every reply under
-- them, in one channel whose row the caller holds, and reports how many
-- rows went.
-- name: DeleteExpiredMessages :execrows
DELETE FROM messages
WHERE id = ANY(sqlc.arg(ids)::uuid[]) OR thread_root_id = ANY(sqlc.arg(ids)::uuid[]);
