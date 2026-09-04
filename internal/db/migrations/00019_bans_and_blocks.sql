-- +goose Up
-- A space's ban list: a banned account can't join (by invite or, for an
-- instance admin, by space id) until unbanned. Owned by chat.
CREATE TABLE space_bans (
    space_id   uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    banned_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    reason     text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (space_id, user_id)
);

-- One person blocking another: no direct messages either way, and the
-- blocker gets no notifications from the blocked. Owned by chat.
CREATE TABLE user_blocks (
    blocker_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    blocked_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX user_blocks_blocked_idx ON user_blocks (blocked_id);

-- +goose Down
DROP TABLE user_blocks;
DROP TABLE space_bans;
