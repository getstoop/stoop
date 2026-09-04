-- +goose Up
-- Owned by the chat module. @here: the message addressed the members who
-- were online when it was sent.
ALTER TABLE messages ADD COLUMN mentions_here boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE messages DROP COLUMN mentions_here;
