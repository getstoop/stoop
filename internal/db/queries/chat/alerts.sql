-- Alert counts: what the badges show. Owned by the chat module.
-- Only internal/chat may use these queries.

-- CountAlerts is, per text channel a person can read, how many live
-- messages addressed to them are past their read marker: a mention of
-- them (message_mentions, which already holds @channel and @here and
-- never the author) or a reply to a message of theirs, by someone they
-- have not blocked. A message the channel shows counts against the
-- channel's marker; a reply only its thread shows against the thread's.
-- Nothing counts in a channel, space or thread they muted. Direct
-- messages are left out: every message there is addressed to them, and
-- unread_count is the number that matters. One space with space_id,
-- every space without. docs/architecture/messaging.md → Alert counts.
--
-- The two halves are driven by rows about the person, so the work is
-- bounded by their mentions and their own messages, not the channel's
-- history: message_mentions_user_idx for the one, messages_author_idx
-- then messages_reply_to_idx for the other.
-- name: CountAlerts :many
WITH addressed AS (
    SELECT m.id, m.channel_id, m.author_id, m.in_channel, m.thread_root_id
    FROM message_mentions mm
    JOIN messages m ON m.id = mm.message_id
    WHERE mm.user_id = sqlc.arg(user_id)::uuid AND m.deleted_at IS NULL
    UNION
    SELECT reply.id, reply.channel_id, reply.author_id, reply.in_channel, reply.thread_root_id
    FROM messages mine
    JOIN messages reply ON reply.reply_to_message_id = mine.id
    WHERE mine.author_id = sqlc.arg(user_id)::uuid AND reply.deleted_at IS NULL
)
SELECT c.space_id, c.id AS channel_id, count(*)::int AS alert_count
FROM addressed m
JOIN channels c ON c.id = m.channel_id
LEFT JOIN channel_reads r ON r.channel_id = c.id AND r.user_id = sqlc.arg(user_id)::uuid
LEFT JOIN thread_reads tr ON tr.root_message_id = m.thread_root_id AND tr.user_id = sqlc.arg(user_id)::uuid
WHERE c.space_id IS NOT NULL AND c.kind = 1
  AND (sqlc.narg(space_id)::uuid IS NULL OR c.space_id = sqlc.narg(space_id)::uuid)
  AND EXISTS (SELECT 1 FROM channel_readers cr WHERE cr.channel_id = c.id AND cr.user_id = sqlc.arg(user_id)::uuid)
  AND m.author_id <> sqlc.arg(user_id)::uuid
  AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = sqlc.arg(user_id)::uuid AND b.blocked_id = m.author_id)
  AND (CASE WHEN m.in_channel
       THEN r.last_read_message_id IS NULL OR m.id > r.last_read_message_id
       ELSE tr.last_read_message_id IS NULL OR m.id > tr.last_read_message_id END)
  AND NOT EXISTS (SELECT 1 FROM channel_mutes cm WHERE cm.user_id = sqlc.arg(user_id)::uuid AND cm.channel_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM space_mutes sm WHERE sm.user_id = sqlc.arg(user_id)::uuid AND sm.space_id = c.space_id)
  AND (m.thread_root_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM thread_mutes tm WHERE tm.user_id = sqlc.arg(user_id)::uuid AND tm.root_message_id = m.thread_root_id))
GROUP BY c.space_id, c.id;
