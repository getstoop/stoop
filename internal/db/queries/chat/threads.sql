-- Threads: a root's replies and its summary row. Owned by the chat module.
-- Only internal/chat may use these queries. docs/architecture/messaging.md.

-- ListThreadBefore pages a thread backwards, like ListMessagesBefore; the
-- root itself is not a reply and is not returned.
-- name: ListThreadBefore :many
SELECT * FROM message_with_reply m
WHERE m.thread_root_id = sqlc.arg(root_id)::uuid
  AND (sqlc.narg('before_id')::uuid IS NULL OR m.id < sqlc.narg('before_id')::uuid)
ORDER BY m.id DESC
LIMIT sqlc.arg('limit');

-- name: ListThreadAfter :many
SELECT * FROM message_with_reply m
WHERE m.thread_root_id = sqlc.arg(root_id)::uuid
  AND (m.id > sqlc.arg('after_id')::uuid OR (sqlc.arg('inclusive')::bool AND m.id = sqlc.arg('after_id')::uuid))
ORDER BY m.id ASC
LIMIT sqlc.arg('limit');

-- RecordThreadReply counts a new reply into its root's summary: the
-- author moves to the front of the recent authors, which keep three.
-- name: RecordThreadReply :one
INSERT INTO threads (root_message_id, reply_count, last_reply_id, last_reply_at, recent_author_ids)
VALUES (sqlc.arg(root_id), 1, sqlc.arg(reply_id), sqlc.arg(reply_at), ARRAY[sqlc.arg(author_id)::uuid])
ON CONFLICT (root_message_id) DO UPDATE SET
    reply_count = threads.reply_count + 1,
    last_reply_id = EXCLUDED.last_reply_id,
    last_reply_at = EXCLUDED.last_reply_at,
    recent_author_ids = (ARRAY[sqlc.arg(author_id)::uuid] || array_remove(threads.recent_author_ids, sqlc.arg(author_id)::uuid))[1:3]
RETURNING root_message_id, reply_count, last_reply_id, last_reply_at, recent_author_ids;
