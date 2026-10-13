-- +goose Up
-- Owned by the chat module. @channel replaces @everyone (STOOP-495): the
-- message flag and the action a credential is granted take the new name.
-- Contract: a binary from before this reads the old column.
DROP VIEW message_with_reply;
ALTER TABLE messages RENAME COLUMN mentions_everyone TO mentions_entire_channel;
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
UPDATE credentials SET grants = array_replace(grants, 'messages.notify_everyone', 'messages.notify_entire_channel')
WHERE 'messages.notify_everyone' = ANY (grants);
UPDATE schema_floor SET min_migration = 65;

-- +goose Down
UPDATE schema_floor SET min_migration = 63;
UPDATE credentials SET grants = array_replace(grants, 'messages.notify_entire_channel', 'messages.notify_everyone')
WHERE 'messages.notify_entire_channel' = ANY (grants);
DROP VIEW message_with_reply;
ALTER TABLE messages RENAME COLUMN mentions_entire_channel TO mentions_everyone;
CREATE VIEW message_with_reply AS
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
