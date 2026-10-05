-- +goose Up
-- Owned by the chat module. A message as the client sees it: every
-- column but the search vector, plus the quote of the message it replies
-- to. Every query that returns a message to a client reads this view.
CREATE VIEW message_with_reply AS
SELECT m.id, m.channel_id, m.author_id, m.content, m.created_at, m.mentions_everyone,
    m.reply_to_message_id, m.mentions_here, m.edited_at,
    p.author_id AS reply_author_id, p.content AS reply_content,
    COALESCE((SELECT a.file_id::text FROM message_attachments a WHERE a.message_id = p.id ORDER BY a.position LIMIT 1), '')::text AS reply_first_file_id
FROM messages m
LEFT JOIN messages p ON p.id = m.reply_to_message_id;

-- +goose Down
DROP VIEW message_with_reply;
