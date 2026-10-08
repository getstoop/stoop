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

-- LockThread takes a root's summary row for the rest of the transaction,
-- so a delete's recount and a concurrent send's increment can't miss
-- each other. No row means the root has no replies.
-- name: LockThread :one
SELECT reply_count FROM threads WHERE root_message_id = $1 FOR UPDATE;

-- RecomputeThread recounts a root's summary from its remaining replies,
-- after one is deleted.
-- name: RecomputeThread :one
WITH replies AS (
    SELECT id, author_id, created_at FROM messages WHERE thread_root_id = sqlc.arg(root_id)::uuid
), latest AS (
    SELECT id, created_at FROM replies ORDER BY id DESC LIMIT 1
), authors AS (
    SELECT author_id, id FROM (
        SELECT DISTINCT ON (author_id) author_id, id FROM replies ORDER BY author_id, id DESC
    ) newest_per_author ORDER BY id DESC LIMIT 3
)
UPDATE threads SET
    reply_count = (SELECT count(*) FROM replies),
    last_reply_id = (SELECT id FROM latest),
    last_reply_at = (SELECT created_at FROM latest),
    recent_author_ids = COALESCE((SELECT array_agg(author_id ORDER BY id DESC) FROM authors), '{}')
WHERE root_message_id = sqlc.arg(root_id)::uuid
RETURNING root_message_id, reply_count, last_reply_id, last_reply_at, recent_author_ids;

-- name: DeleteThreadSummary :exec
DELETE FROM threads WHERE root_message_id = $1;

-- MakePlaceholder keeps a root whose thread still has replies as an empty
-- row: no text, attachments, previews, reactions, mentions, pin or
-- activity. Its files are deleted through the port afterwards.
-- name: MakePlaceholder :exec
WITH attachments AS (DELETE FROM message_attachments WHERE message_id = sqlc.arg(id)::uuid),
links AS (DELETE FROM message_links WHERE message_id = sqlc.arg(id)::uuid),
reactions AS (DELETE FROM message_reactions WHERE message_id = sqlc.arg(id)::uuid),
mentions AS (DELETE FROM message_mentions WHERE message_id = sqlc.arg(id)::uuid),
pins AS (DELETE FROM channel_pins WHERE message_id = sqlc.arg(id)::uuid),
activity AS (DELETE FROM activity_items WHERE message_id = sqlc.arg(id)::uuid)
UPDATE messages SET content = '', mentions_everyone = false, mentions_here = false,
    edited_at = NULL, deleted_at = now()
WHERE id = sqlc.arg(id)::uuid;

-- ListThreadFileIDs lists the files of a root and every reply under it,
-- for Delete thread.
-- name: ListThreadFileIDs :many
SELECT a.file_id FROM message_attachments a
JOIN messages m ON m.id = a.message_id
WHERE m.id = sqlc.arg(root_id)::uuid OR m.thread_root_id = sqlc.arg(root_id)::uuid;

-- ThreadParticipants are who a new reply's thread_reply activity goes
-- to: the people in the thread before reply_id (its root's author,
-- repliers, and people @mentioned by name, as ThreadViewerStates counts
-- them), less anyone who muted it and anyone no longer in the space (or,
-- for a DM, the conversation): message rows outlive a leave or a kick.
-- name: ThreadParticipants :many
WITH thread AS (
    SELECT m.id, m.channel_id, m.author_id, m.mentions_everyone, m.mentions_here FROM messages m
    WHERE m.id = sqlc.arg(root_id)::uuid
       OR (m.thread_root_id = sqlc.arg(root_id)::uuid AND m.id < sqlc.arg(reply_id)::uuid)
), people AS (
    SELECT t.author_id AS user_id FROM thread t
    UNION
    SELECT mm.user_id FROM message_mentions mm JOIN thread t ON t.id = mm.message_id
    WHERE NOT t.mentions_everyone AND NOT t.mentions_here
)
SELECT p.user_id FROM people p
JOIN channels c ON c.id = (SELECT channel_id FROM thread WHERE id = sqlc.arg(root_id)::uuid)
WHERE (EXISTS (SELECT 1 FROM space_members sm WHERE sm.space_id = c.space_id AND sm.user_id = p.user_id)
       OR EXISTS (SELECT 1 FROM dm_members dm WHERE dm.channel_id = c.id AND dm.user_id = p.user_id))
  AND NOT EXISTS (SELECT 1 FROM thread_mutes tm
                  WHERE tm.user_id = p.user_id AND tm.root_message_id = sqlc.arg(root_id)::uuid);
