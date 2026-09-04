-- Owned by the chat module. See docs/proposals/message-search.md.
-- Expand-only: the previous release ignores both objects. Adding the
-- stored column rewrites the table once, so this migration takes time
-- proportional to the number of messages.
-- +goose Up
ALTER TABLE messages
    ADD COLUMN search tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;

CREATE INDEX messages_search_idx ON messages USING gin (search);

-- +goose Down
DROP INDEX messages_search_idx;
ALTER TABLE messages DROP COLUMN search;
