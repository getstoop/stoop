-- +goose Up
-- A member's own mute for one channel (a space's or a DM): no unread
-- bold or dot, no desktop alert; mentions still count. Owned by chat.
CREATE TABLE channel_mutes (
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, channel_id)
);

-- +goose Down
DROP TABLE channel_mutes;
