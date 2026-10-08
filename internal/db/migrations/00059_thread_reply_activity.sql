-- +goose Up
-- Owned by the chat module. thread_reply: one activity entry per thread
-- for the people in it (STOOP-434). NOT VALID skips a scan of rows that
-- all hold an older kind.
ALTER TABLE activity_items DROP CONSTRAINT activity_items_kind_valid,
    ADD CONSTRAINT activity_items_kind_valid
        CHECK (kind IN ('mention', 'reply', 'dm', 'thread_reply')) NOT VALID;

-- +goose Down
DELETE FROM activity_items WHERE kind = 'thread_reply';
ALTER TABLE activity_items DROP CONSTRAINT activity_items_kind_valid,
    ADD CONSTRAINT activity_items_kind_valid CHECK (kind IN ('mention', 'reply', 'dm'));
