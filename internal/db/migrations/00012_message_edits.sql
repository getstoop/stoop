-- +goose Up
-- Owned by the chat module.
ALTER TABLE messages ADD COLUMN edited_at timestamptz;

-- +goose Down
ALTER TABLE messages DROP COLUMN edited_at;
