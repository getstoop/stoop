-- +goose Up
-- Owned by the chat module. A group is a set of a space's members that
-- @@handle mentions all at once. Leaving the space takes the person out
-- of its groups through the foreign key.
CREATE TABLE groups (
    id         uuid PRIMARY KEY,
    space_id   uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    handle     text NOT NULL CHECK (handle ~ '^[a-z0-9_]{3,32}$'),
    name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (space_id, handle),
    UNIQUE (id, space_id)
);

CREATE TABLE group_members (
    group_id uuid NOT NULL,
    space_id uuid NOT NULL,
    user_id  uuid NOT NULL,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id, space_id)
        REFERENCES groups (id, space_id) ON DELETE CASCADE,
    FOREIGN KEY (space_id, user_id)
        REFERENCES space_members (space_id, user_id) ON DELETE CASCADE
);
CREATE INDEX group_members_member_idx ON group_members (space_id, user_id);

-- +goose Down
DROP TABLE group_members;
DROP TABLE groups;
