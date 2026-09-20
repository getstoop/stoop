-- Owned by the chat module. See docs/architecture/data.md#foreign-keys.
-- Expand-only: the previous release ignores both indexes. Each build
-- reads its table once, about 0.1 s per million messages.
-- +goose Up
CREATE INDEX messages_reply_to_idx ON messages (reply_to_message_id)
    WHERE reply_to_message_id IS NOT NULL;

CREATE INDEX activity_items_message_idx ON activity_items (message_id)
    WHERE message_id IS NOT NULL;

-- +goose Down
DROP INDEX activity_items_message_idx;
DROP INDEX messages_reply_to_idx;
