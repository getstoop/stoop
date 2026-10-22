-- +goose Up
-- Owned by the chat module. The channel log (docs/proposals/channel-log.md):
-- channels.seq counts the channel's render-affecting message writes, and
-- each one stamps messages.seq with the value it took, so a client can
-- tell which copy of a row is newer and what it has missed. swept_seq is
-- for the retention sweep to record the highest seq it hard-deleted; this
-- release leaves it at 0. messages.seq is nullable this release and NOT
-- NULL the next (expand/contract).
ALTER TABLE channels ADD COLUMN seq bigint NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN swept_seq bigint NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN seq bigint;

-- Backfill: a channel's messages take 1..n in id order (UUIDv7, so time
-- order), and its counter is n. Goose runs the file in one transaction,
-- so a start killed midway runs it again from the top.
UPDATE messages m SET seq = numbered.seq
FROM (SELECT id, row_number() OVER (PARTITION BY channel_id ORDER BY id) AS seq FROM messages) numbered
WHERE numbered.id = m.id;
UPDATE channels c SET seq = (SELECT count(*) FROM messages m WHERE m.channel_id = c.id);

-- Built after the backfill, so the fill doesn't maintain it row by row.
CREATE INDEX messages_channel_seq_idx ON messages (channel_id, seq);

-- The view carries every messages column but search; a new column goes
-- at its end (CREATE OR REPLACE can only append).
CREATE OR REPLACE VIEW message_with_reply AS
SELECT m.id, m.channel_id, m.author_id, m.content, m.created_at, m.mentions_entire_channel,
    m.reply_to_message_id, m.mentions_here, m.edited_at,
    p.author_id AS reply_author_id,
    p.content AS reply_content,
    COALESCE((SELECT a.file_id::text FROM message_attachments a WHERE a.message_id = p.id ORDER BY a.position LIMIT 1), '')::text AS reply_first_file_id,
    m.thread_root_id, m.in_channel, m.deleted_at,
    COALESCE(t.reply_count, 0)::integer AS thread_reply_count,
    t.last_reply_at AS thread_last_reply_at,
    COALESCE(t.recent_author_ids, '{}')::uuid[] AS thread_recent_author_ids,
    m.seq
FROM messages m
LEFT JOIN messages p ON p.id = m.reply_to_message_id AND p.deleted_at IS NULL
LEFT JOIN threads t ON t.root_message_id = m.id;

-- +goose Down
DROP VIEW message_with_reply;
CREATE VIEW message_with_reply AS
SELECT m.id, m.channel_id, m.author_id, m.content, m.created_at, m.mentions_entire_channel,
    m.reply_to_message_id, m.mentions_here, m.edited_at,
    p.author_id AS reply_author_id,
    p.content AS reply_content,
    COALESCE((SELECT a.file_id::text FROM message_attachments a WHERE a.message_id = p.id ORDER BY a.position LIMIT 1), '')::text AS reply_first_file_id,
    m.thread_root_id, m.in_channel, m.deleted_at,
    COALESCE(t.reply_count, 0)::integer AS thread_reply_count,
    t.last_reply_at AS thread_last_reply_at,
    COALESCE(t.recent_author_ids, '{}')::uuid[] AS thread_recent_author_ids
FROM messages m
LEFT JOIN messages p ON p.id = m.reply_to_message_id AND p.deleted_at IS NULL
LEFT JOIN threads t ON t.root_message_id = m.id;
DROP INDEX messages_channel_seq_idx;
ALTER TABLE messages DROP COLUMN seq;
ALTER TABLE channels DROP COLUMN swept_seq, DROP COLUMN seq;
