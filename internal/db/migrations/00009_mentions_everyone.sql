-- +goose Up
-- Owned by the chat module. Whether a message addressed the whole space
-- (an @everyone the author was allowed to use); recipients are still
-- materialised in message_mentions so notifications stay uniform.
ALTER TABLE messages ADD COLUMN mentions_everyone boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE messages DROP COLUMN mentions_everyone;
