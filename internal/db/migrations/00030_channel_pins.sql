-- +goose Up
-- Messages a channel keeps: who pinned each and when. Owned by the chat
-- module. See docs/proposals/pinned-messages.md. Expand-only, and nothing
-- backfills — the previous release ignores the table.
--
-- message_id is the key, not (channel_id, message_id): a message belongs
-- to one channel, so the pair could hold a contradiction. The cascades do
-- the cleanup — deleting the message, the channel or the pinner's account
-- drops the pin.
CREATE TABLE channel_pins (
    message_id uuid PRIMARY KEY REFERENCES messages (id) ON DELETE CASCADE,
    channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    pinned_by  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    pinned_at  timestamptz NOT NULL DEFAULT now()
);

-- The list query, in its order.
CREATE INDEX channel_pins_channel_idx ON channel_pins (channel_id, pinned_at DESC);

-- +goose Down
DROP TABLE channel_pins;
