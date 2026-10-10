-- +goose Up
-- Owned by the chat module. Who is in a text channel (STOOP-466). A
-- required channel holds a row for every member of its space.
ALTER TABLE channels ADD COLUMN required boolean NOT NULL DEFAULT false;
ALTER TABLE channels ADD CONSTRAINT channels_required_is_space_text
    CHECK (NOT required OR (space_id IS NOT NULL AND kind = 1));

-- The key onto space_members is the cleanup: leaving the space, by any
-- path, takes the person's channel rows with it.
CREATE TABLE channel_members (
    channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    space_id   uuid NOT NULL,
    user_id    uuid NOT NULL,
    added_by   uuid REFERENCES users (id) ON DELETE SET NULL,
    added_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (channel_id, user_id),
    FOREIGN KEY (space_id, user_id)
        REFERENCES space_members (space_id, user_id) ON DELETE CASCADE
);
CREATE INDEX channel_members_user_idx ON channel_members (user_id, space_id);

ALTER TABLE messages ADD COLUMN mentions_channel boolean NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW message_with_reply AS
SELECT m.id, m.channel_id, m.author_id, m.content, m.created_at, m.mentions_everyone,
    m.reply_to_message_id, m.mentions_here, m.edited_at,
    p.author_id AS reply_author_id,
    p.content AS reply_content,
    COALESCE((SELECT a.file_id::text FROM message_attachments a WHERE a.message_id = p.id ORDER BY a.position LIMIT 1), '')::text AS reply_first_file_id,
    m.thread_root_id, m.in_channel, m.deleted_at,
    COALESCE(t.reply_count, 0)::integer AS thread_reply_count,
    t.last_reply_at AS thread_last_reply_at,
    COALESCE(t.recent_author_ids, '{}')::uuid[] AS thread_recent_author_ids,
    m.mentions_channel
FROM messages m
LEFT JOIN messages p ON p.id = m.reply_to_message_id AND p.deleted_at IS NULL
LEFT JOIN threads t ON t.root_message_id = m.id;

-- Everyone already in a space stays in all of its text channels.
INSERT INTO channel_members (channel_id, space_id, user_id)
SELECT c.id, c.space_id, m.user_id
FROM channels c
JOIN space_members m ON m.space_id = c.space_id
WHERE c.kind = 1;

-- Every space has a default channel from here on, and it is required.
UPDATE spaces s SET default_channel_id = (
    SELECT f.id FROM channels f
    WHERE f.space_id = s.id AND f.kind = 1
    ORDER BY f.position, f.created_at LIMIT 1)
WHERE s.default_channel_id IS NULL;

UPDATE channels SET required = true
WHERE id IN (SELECT default_channel_id FROM spaces);

-- +goose Down
DROP VIEW message_with_reply;
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
ALTER TABLE messages DROP COLUMN mentions_channel;
DROP TABLE channel_members;
ALTER TABLE channels DROP COLUMN required;
