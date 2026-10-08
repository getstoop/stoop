-- Thread mutes and read markers (STOOP-433). Owned by the chat module.
-- Only internal/chat may use these queries. docs/architecture/messaging.md.

-- name: MuteThread :exec
INSERT INTO thread_mutes (user_id, root_message_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: UnmuteThread :exec
DELETE FROM thread_mutes WHERE user_id = $1 AND root_message_id = $2;

-- ListThreadMutes is Profile → Muted's threads, newest mute first, in
-- channels the person can still read.
-- name: ListThreadMutes :many
SELECT sqlc.embed(m), c.space_id AS root_space_id
FROM thread_mutes tm
JOIN message_with_reply m ON m.id = tm.root_message_id
JOIN channels c ON c.id = m.channel_id
WHERE tm.user_id = $1
  AND (EXISTS (SELECT 1 FROM space_members sm WHERE sm.space_id = c.space_id AND sm.user_id = $1)
       OR EXISTS (SELECT 1 FROM dm_members dm WHERE dm.channel_id = c.id AND dm.user_id = $1))
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
-- @everyone and @here don't count), whether they muted it, and how many
-- replies by others came after their read marker.
-- name: ThreadViewerStates :many
SELECT r.id AS root_id,
    (r.author_id = sqlc.arg(user_id)::uuid
     OR EXISTS (SELECT 1 FROM messages m
                WHERE m.thread_root_id = r.id AND m.author_id = sqlc.arg(user_id)::uuid)
     OR EXISTS (SELECT 1 FROM message_mentions mm JOIN messages m ON m.id = mm.message_id
                WHERE mm.user_id = sqlc.arg(user_id)::uuid
                  AND (m.id = r.id OR m.thread_root_id = r.id)
                  AND NOT m.mentions_everyone AND NOT m.mentions_here))::bool AS participating,
    EXISTS (SELECT 1 FROM thread_mutes tm
            WHERE tm.user_id = sqlc.arg(user_id)::uuid AND tm.root_message_id = r.id)::bool AS muted,
    (SELECT count(*) FROM messages m
     WHERE m.thread_root_id = r.id AND m.author_id <> sqlc.arg(user_id)::uuid
       AND m.id > COALESCE((SELECT tr.last_read_message_id FROM thread_reads tr
                            WHERE tr.user_id = sqlc.arg(user_id)::uuid AND tr.root_message_id = r.id),
                           '00000000-0000-0000-0000-000000000000'::uuid))::int AS unread_count
FROM messages r
WHERE r.id = ANY(sqlc.arg(root_ids)::uuid[]);

-- name: ThreadLastReply :one
SELECT last_reply_id FROM threads WHERE root_message_id = $1;
