-- +goose Up
-- Owned by the chat module. A private channel is a space channel with a
-- people list: reading it needs a channel_members row as well as space
-- membership. Only private channels have rows. Leaving the space takes
-- the person out of its private channels through the foreign key.
ALTER TABLE channels ADD COLUMN private boolean NOT NULL DEFAULT false;
ALTER TABLE channels ADD CONSTRAINT channels_private_in_space
    CHECK (NOT private OR space_id IS NOT NULL);

CREATE TABLE channel_members (
    channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    space_id   uuid NOT NULL,
    user_id    uuid NOT NULL,
    added_by   uuid REFERENCES users (id) ON DELETE SET NULL,
    added_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (channel_id, user_id),
    FOREIGN KEY (space_id, user_id)
        REFERENCES space_members (space_id, user_id) ON DELETE CASCADE
);
CREATE INDEX channel_members_user_idx ON channel_members (user_id);

CREATE OR REPLACE VIEW channel_readers AS
SELECT c.id AS channel_id, sm.user_id
FROM channels c
JOIN space_members sm ON sm.space_id = c.space_id
WHERE NOT c.private
UNION ALL
SELECT dm.channel_id, dm.user_id
FROM dm_members dm
UNION ALL
SELECT cm.channel_id, cm.user_id
FROM channel_members cm;

-- A binary from before this migration would treat every private channel
-- as public, so it must refuse to start: the floor rises though nothing
-- is dropped.
UPDATE schema_floor SET min_migration = 63;

-- +goose Down
UPDATE schema_floor SET min_migration = 53;

CREATE OR REPLACE VIEW channel_readers AS
SELECT c.id AS channel_id, sm.user_id
FROM channels c
JOIN space_members sm ON sm.space_id = c.space_id
UNION ALL
SELECT dm.channel_id, dm.user_id
FROM dm_members dm;

DROP TABLE channel_members;
ALTER TABLE channels DROP CONSTRAINT channels_private_in_space;
ALTER TABLE channels DROP COLUMN private;
