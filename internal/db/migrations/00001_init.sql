-- +goose Up
CREATE EXTENSION IF NOT EXISTS citext;

-- Owned by the auth module.
CREATE TABLE users (
    id            uuid PRIMARY KEY,
    username      citext NOT NULL UNIQUE,
    display_name  text NOT NULL DEFAULT '',
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Owned by the auth module. token_hash is the SHA-256 of the opaque token;
-- the raw token is never stored.
CREATE TABLE sessions (
    id         uuid PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

-- Owned by the chat module. A space is the community-level container.
CREATE TABLE spaces (
    id         uuid PRIMARY KEY,
    name       text NOT NULL,
    owner_id   uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE space_members (
    space_id  uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (space_id, user_id)
);

-- kind mirrors stoop.chat.v1.ChannelKind: 1 = text, 2 = voice.
CREATE TABLE channels (
    id         uuid PRIMARY KEY,
    space_id   uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    name       text NOT NULL,
    kind       smallint NOT NULL DEFAULT 1,
    position   int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
    id         uuid PRIMARY KEY,
    channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    author_id  uuid NOT NULL REFERENCES users (id),
    content    text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_channel_recent_idx ON messages (channel_id, id DESC);
CREATE INDEX space_members_user_idx ON space_members (user_id);
CREATE INDEX channels_space_idx ON channels (space_id, position);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- +goose Down
DROP TABLE messages;
DROP TABLE channels;
DROP TABLE space_members;
DROP TABLE spaces;
DROP TABLE sessions;
DROP TABLE users;
