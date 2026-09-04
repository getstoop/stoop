-- +goose Up
-- Owned by the chat module.

-- Newest message per channel, maintained on send, so the channel list can
-- answer "anything new?" without touching the messages table.
ALTER TABLE channels
    ADD COLUMN last_message_id uuid REFERENCES messages (id) ON DELETE SET NULL;
UPDATE channels c
SET last_message_id = (
    SELECT m.id FROM messages m WHERE m.channel_id = c.id ORDER BY m.id DESC LIMIT 1
);

-- Per-user read marker: the newest message the user has seen in a channel.
-- One row per (user, channel); only ever moves forward.
CREATE TABLE channel_reads (
    user_id              uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    channel_id           uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    last_read_message_id uuid NOT NULL,
    updated_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, channel_id)
);

-- +goose Down
DROP TABLE channel_reads;
ALTER TABLE channels DROP COLUMN last_message_id;
