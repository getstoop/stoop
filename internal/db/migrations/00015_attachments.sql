-- +goose Up
-- Attachments in messages (STOOP-42).

-- The original filename, sanitised, for attachments (empty for avatars
-- and icons, which are never shown by name). Owned by the files module.
ALTER TABLE files ADD COLUMN name text NOT NULL DEFAULT '';

-- Owned by the chat module: which files a message carries, in order. A
-- file belongs to at most one message (UNIQUE), so claiming an already
-- used upload fails at the database, not by a check that could race.
CREATE TABLE message_attachments (
    message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    file_id    uuid NOT NULL UNIQUE REFERENCES files (id) ON DELETE CASCADE,
    position   int NOT NULL DEFAULT 0,
    PRIMARY KEY (message_id, file_id)
);

-- +goose Down
DROP TABLE message_attachments;
ALTER TABLE files DROP COLUMN name;
