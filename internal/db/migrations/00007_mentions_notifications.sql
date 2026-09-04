-- +goose Up
-- Owned by the chat module.

-- Who a message mentions (resolved to members of the space at send time).
CREATE TABLE message_mentions (
    message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX message_mentions_user_idx ON message_mentions (user_id);

-- Per-user notifications. kind is 'mention' today; the shape (actor,
-- space/channel/message pointers, read marker) is meant to host more kinds.
CREATE TABLE notifications (
    id         uuid PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind       text NOT NULL CONSTRAINT notifications_kind_valid CHECK (kind IN ('mention')),
    space_id   uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    message_id uuid REFERENCES messages (id) ON DELETE CASCADE,
    actor_id   uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at    timestamptz
);
CREATE INDEX notifications_user_recent_idx ON notifications (user_id, id DESC);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- +goose Down
DROP TABLE notifications;
DROP TABLE message_mentions;
