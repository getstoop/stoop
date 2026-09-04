-- +goose Up
-- A member's own mute for a whole space: it silences every channel there
-- and the space's own rail dot and badge; mentions still reach activity.
-- Owned by chat.
CREATE TABLE space_mutes (
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    space_id   uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, space_id)
);

-- +goose Down
DROP TABLE space_mutes;
