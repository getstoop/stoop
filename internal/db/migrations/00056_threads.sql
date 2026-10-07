-- +goose Up
-- Owned by the chat module. Threads (STOOP-421): a reply can belong to a
-- thread under a top-level root, and in_channel says whether it also shows
-- in the channel's timeline. deleted_at marks a root kept as a placeholder
-- because its thread still has replies. docs/architecture/messaging.md.
ALTER TABLE messages
    ADD COLUMN thread_root_id uuid REFERENCES messages (id) ON DELETE CASCADE,
    ADD COLUMN in_channel boolean NOT NULL DEFAULT true,
    ADD COLUMN deleted_at timestamptz;

-- NOT VALID skips a scan of every existing row; they are all in_channel.
ALTER TABLE messages ADD CONSTRAINT messages_off_channel_needs_thread
    CHECK (in_channel OR thread_root_id IS NOT NULL) NOT VALID;

-- A channel's history reads only the rows that show in the channel, so a
-- page stays cheap when most of the talk is in threads. A plain build:
-- nothing writes during migration, and CONCURRENTLY would wait forever on
-- a second instance queued behind the migration lock.
CREATE INDEX messages_channel_timeline_idx ON messages (channel_id, id DESC)
    WHERE in_channel;
CREATE INDEX messages_thread_idx ON messages (thread_root_id, id DESC)
    WHERE thread_root_id IS NOT NULL;

-- One row per root with replies: what the summary line under the root
-- shows, kept by the send and delete paths so a page of history needs no
-- count per message.
CREATE TABLE threads (
    root_message_id   uuid PRIMARY KEY REFERENCES messages (id) ON DELETE CASCADE,
    reply_count       integer NOT NULL DEFAULT 0,
    last_reply_id     uuid,
    last_reply_at     timestamptz,
    recent_author_ids uuid[] NOT NULL DEFAULT '{}'
);

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

-- +goose Down
DROP VIEW message_with_reply;
CREATE VIEW message_with_reply AS
SELECT m.id, m.channel_id, m.author_id, m.content, m.created_at, m.mentions_everyone,
    m.reply_to_message_id, m.mentions_here, m.edited_at,
    p.author_id AS reply_author_id, p.content AS reply_content,
    COALESCE((SELECT a.file_id::text FROM message_attachments a WHERE a.message_id = p.id ORDER BY a.position LIMIT 1), '')::text AS reply_first_file_id
FROM messages m
LEFT JOIN messages p ON p.id = m.reply_to_message_id;
DROP TABLE threads;
DROP INDEX messages_thread_idx;
DROP INDEX messages_channel_timeline_idx;
ALTER TABLE messages DROP CONSTRAINT messages_off_channel_needs_thread;
ALTER TABLE messages
    DROP COLUMN deleted_at,
    DROP COLUMN in_channel,
    DROP COLUMN thread_root_id;
