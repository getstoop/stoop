-- +goose Up
-- Owned by the chat module. Polls (STOOP-544): a poll is a messages row
-- of kind 7 whose data holds the question and options, and its closing
-- row is kind 8 (internal/chat/polls.go). poll_votes holds who chose
-- which option: one row per person and option, so a poll of several
-- choices is several rows. docs/architecture/messaging.md → Polls.
--
-- Additive: an older binary never reads the table or the view's new
-- column. The primary key leads with message_id, which the retention
-- sweep's bulk delete of messages needs (data.md → Foreign keys). That
-- an option exists, and that a single-choice poll gets one, is the write
-- path's rule: both live in the poll row's data.
CREATE TABLE poll_votes (
    message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    option_id  smallint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id, option_id)
);

-- reference_kind goes at the view's end (CREATE OR REPLACE can only
-- append): the kind of the message a system row is about, so its excerpt
-- can be worded for a poll.
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
    COALESCE((SELECT a.file_id::text FROM message_attachments a WHERE a.message_id = ref.id ORDER BY a.position LIMIT 1), '')::text AS reference_first_file_id,
    ref.kind AS reference_kind
FROM messages m
LEFT JOIN messages p ON p.id = m.reply_to_message_id AND p.deleted_at IS NULL
LEFT JOIN threads t ON t.root_message_id = m.id
LEFT JOIN messages ref ON ref.id = m.reference_message_id AND ref.channel_id = m.channel_id
    AND ref.deleted_at IS NULL;

-- +goose Down
-- The view as 00077 left it. Poll and closing rows stay: to the schema
-- below this line they are system rows of a kind the binary does not
-- know, which it already reads. Their votes go with the table.
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
    m.seq,
    m.kind, m.data, m.quiet, m.reference_message_id,
    ref.author_id AS reference_author_id,
    ref.content AS reference_content,
    COALESCE((SELECT a.file_id::text FROM message_attachments a WHERE a.message_id = ref.id ORDER BY a.position LIMIT 1), '')::text AS reference_first_file_id
FROM messages m
LEFT JOIN messages p ON p.id = m.reply_to_message_id AND p.deleted_at IS NULL
LEFT JOIN threads t ON t.root_message_id = m.id
LEFT JOIN messages ref ON ref.id = m.reference_message_id AND ref.channel_id = m.channel_id
    AND ref.deleted_at IS NULL;
DROP TABLE poll_votes;
