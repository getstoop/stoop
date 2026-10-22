-- Thread mutes and read markers (STOOP-433). Owned by the chat module.
-- Only internal/chat may use these queries. docs/architecture/messaging.md.

-- MuteThread mutes a thread whose root is still shown: live, or a
-- placeholder with live replies. The handler checked the root before
-- this write, and a delete can commit in between.
-- name: MuteThread :exec
INSERT INTO thread_mutes (user_id, root_message_id)
SELECT sqlc.arg(user_id)::uuid, m.id FROM messages m
WHERE m.id = sqlc.arg(root_message_id)::uuid
  AND (m.deleted_at IS NULL OR EXISTS (SELECT 1 FROM threads t WHERE t.root_message_id = m.id))
ON CONFLICT DO NOTHING;

-- name: UnmuteThread :exec
DELETE FROM thread_mutes WHERE user_id = $1 AND root_message_id = $2;

-- DeleteThreadViewerRows drops every person's mute and read marker for a
-- thread nobody is shown any more: its root is a tombstone with no live
-- reply. A hard delete used to cascade them.
-- name: DeleteThreadViewerRows :exec
WITH mutes AS (DELETE FROM thread_mutes WHERE root_message_id = sqlc.arg(root_id)::uuid)
DELETE FROM thread_reads WHERE root_message_id = sqlc.arg(root_id)::uuid;

-- ListThreadMutes is Profile → Muted's threads, newest mute first, in
-- channels the person can still read; the caller drops hidden voice
-- channels, as accessChannel does. A root nobody is shown (a tombstone
-- with no live reply) is left out, as GetMessage leaves it out.
-- name: ListThreadMutes :many
SELECT sqlc.embed(m), sqlc.embed(c)
FROM thread_mutes tm
JOIN message_with_reply m ON m.id = tm.root_message_id
JOIN channels c ON c.id = m.channel_id
WHERE tm.user_id = $1
  AND (m.deleted_at IS NULL OR EXISTS (SELECT 1 FROM threads t WHERE t.root_message_id = m.id))
  AND EXISTS (SELECT 1 FROM channel_readers cr WHERE cr.channel_id = c.id AND cr.user_id = $1)
ORDER BY tm.created_at DESC
LIMIT 200;

-- MarkThreadRead moves a read marker forward only, and returns where it
-- ends up.
-- name: MarkThreadRead :one
INSERT INTO thread_reads (user_id, root_message_id, last_read_message_id)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, root_message_id) DO UPDATE
SET last_read_message_id = GREATEST(thread_reads.last_read_message_id, EXCLUDED.last_read_message_id),
    updated_at = now()
RETURNING last_read_message_id;

-- ThreadViewerStates is one person's view of each root: whether they are
-- in its thread (started it, replied, or were @mentioned by name in it;
-- @channel and @here don't count), whether they muted it, and how many
-- replies by others came after their read marker. A deleted reply is a
-- tombstone and counts for nothing here.
-- name: ThreadViewerStates :many
SELECT r.id AS root_id,
    (r.author_id = sqlc.arg(user_id)::uuid
     OR EXISTS (SELECT 1 FROM messages m
                WHERE m.thread_root_id = r.id AND m.author_id = sqlc.arg(user_id)::uuid AND m.deleted_at IS NULL)
     OR EXISTS (SELECT 1 FROM message_mentions mm JOIN messages m ON m.id = mm.message_id
                WHERE mm.user_id = sqlc.arg(user_id)::uuid
                  AND (m.id = r.id OR m.thread_root_id = r.id)
                  AND NOT m.mentions_entire_channel AND NOT m.mentions_here))::bool AS participating,
    EXISTS (SELECT 1 FROM thread_mutes tm
            WHERE tm.user_id = sqlc.arg(user_id)::uuid AND tm.root_message_id = r.id)::bool AS muted,
    (SELECT count(*) FROM messages m
     WHERE m.thread_root_id = r.id AND m.author_id <> sqlc.arg(user_id)::uuid AND m.deleted_at IS NULL
       AND m.id > COALESCE((SELECT tr.last_read_message_id FROM thread_reads tr
                            WHERE tr.user_id = sqlc.arg(user_id)::uuid AND tr.root_message_id = r.id),
                           '00000000-0000-0000-0000-000000000000'::uuid))::int AS unread_count
FROM messages r
WHERE r.id = ANY(sqlc.arg(root_ids)::uuid[]);

-- name: ThreadLastReply :one
SELECT last_reply_id FROM threads WHERE root_message_id = $1;
