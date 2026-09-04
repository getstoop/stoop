-- +goose Up
-- Owned by the chat module.

-- Emoji reactions: one row per (message, user, emoji). The emoji is stored
-- as its Unicode string (skin tones and other modifiers make it distinct);
-- the chat module validates it as a single grapheme cluster of ≤ 16 bytes.
CREATE TABLE message_reactions (
    message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    emoji      text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX message_reactions_message_idx ON message_reactions (message_id);

-- +goose Down
DROP TABLE message_reactions;
