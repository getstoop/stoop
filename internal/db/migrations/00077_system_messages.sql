-- +goose Up
-- Owned by the chat module. System messages (STOOP-534): a messages row
-- that records an event in a channel. kind 0 is a message someone wrote
-- and each system kind has its own number (internal/chat/system_messages.go),
-- data is the kind's structured data, quiet says the row never marks a
-- channel unread, and reference_message_id is the message the row is
-- about. docs/architecture/messaging.md → System messages.
--
-- Additive: an older binary writes rows with the defaults. The two checks
-- and the foreign key each read every existing row once, with no rewrite;
-- docs/architecture/data.md → Upgrades and rollback has the timing.
ALTER TABLE messages
    ADD COLUMN kind smallint NOT NULL DEFAULT 0,
    ADD COLUMN data jsonb,
    ADD COLUMN quiet boolean NOT NULL DEFAULT false,
    ADD COLUMN reference_message_id uuid REFERENCES messages (id) ON DELETE SET NULL,
    -- A kind that carries nothing stores '{}', never NULL.
    ADD CONSTRAINT messages_kind_has_data CHECK ((kind = 0) = (data IS NULL)),
    ADD CONSTRAINT messages_reference_needs_kind CHECK (reference_message_id IS NULL OR kind <> 0);

-- The retention sweep deletes messages in bulk, and every column that
-- references messages needs its index for that (data.md → Foreign keys).
CREATE INDEX messages_reference_idx ON messages (reference_message_id)
    WHERE reference_message_id IS NOT NULL;

-- The new columns go at the view's end (CREATE OR REPLACE can only
-- append), with the referenced message's author, content and first
-- attachment beside them, as the reply's are.
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
    m.seq,
    m.kind, m.data, m.quiet, m.reference_message_id,
    ref.author_id AS reference_author_id,
    ref.content AS reference_content,
    COALESCE((SELECT a.file_id::text FROM message_attachments a WHERE a.message_id = ref.id ORDER BY a.position LIMIT 1), '')::text AS reference_first_file_id
FROM messages m
LEFT JOIN messages p ON p.id = m.reply_to_message_id AND p.deleted_at IS NULL
LEFT JOIN threads t ON t.root_message_id = m.id
LEFT JOIN messages ref ON ref.id = m.reference_message_id AND ref.deleted_at IS NULL;

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
    COALESCE(t.recent_author_ids, '{}')::uuid[] AS thread_recent_author_ids,
    m.seq
FROM messages m
LEFT JOIN messages p ON p.id = m.reply_to_message_id AND p.deleted_at IS NULL
LEFT JOIN threads t ON t.root_message_id = m.id;
-- System rows mean nothing to the schema below this line.
DELETE FROM messages WHERE kind <> 0;
DROP INDEX messages_reference_idx;
ALTER TABLE messages
    DROP CONSTRAINT messages_reference_needs_kind,
    DROP CONSTRAINT messages_kind_has_data,
    DROP COLUMN reference_message_id,
    DROP COLUMN quiet,
    DROP COLUMN data,
    DROP COLUMN kind;
