-- +goose Up
-- Owned by the chat module. A quote of a root kept as a placeholder reads
-- like a quote of a deleted message: no author and no text (STOOP-424).
CREATE OR REPLACE VIEW message_with_reply AS
SELECT m.id, m.channel_id, m.author_id, m.content, m.created_at, m.mentions_everyone,
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

-- +goose Down
CREATE OR REPLACE VIEW message_with_reply AS
SELECT m.id, m.channel_id, m.author_id, m.content, m.created_at, m.mentions_everyone,
    m.reply_to_message_id, m.mentions_here, m.edited_at,
    p.author_id AS reply_author_id, p.content AS reply_content,
    COALESCE((SELECT a.file_id::text FROM message_attachments a WHERE a.message_id = p.id ORDER BY a.position LIMIT 1), '')::text AS reply_first_file_id,
    m.thread_root_id, m.in_channel, m.deleted_at,
    COALESCE(t.reply_count, 0)::integer AS thread_reply_count,
    t.last_reply_at AS thread_last_reply_at,
    COALESCE(t.recent_author_ids, '{}')::uuid[] AS thread_recent_author_ids
FROM messages m
LEFT JOIN messages p ON p.id = m.reply_to_message_id
LEFT JOIN threads t ON t.root_message_id = m.id;
