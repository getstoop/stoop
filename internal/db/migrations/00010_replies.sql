-- +goose Up
-- Owned by the chat module.
ALTER TABLE messages
    ADD COLUMN reply_to_message_id uuid REFERENCES messages (id) ON DELETE SET NULL;

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_valid;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_kind_valid CHECK (kind IN ('mention', 'reply'));

-- +goose Down
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_valid;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_kind_valid CHECK (kind IN ('mention'));
ALTER TABLE messages DROP COLUMN reply_to_message_id;
