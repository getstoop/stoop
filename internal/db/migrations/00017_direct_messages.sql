-- +goose Up
-- Direct messages are channels with no space (kind 3). Participants live in
-- dm_members — a table rather than two columns so group DMs can follow
-- without another migration — and dm_key (the participant ids, sorted and
-- joined) makes "open a DM with X" idempotent under a race. Messages, read
-- markers, reactions, attachments and previews hang off channel_id and
-- need nothing new. channels_space_idx keeps indexing every row; the DM
-- rows sit in a NULL run that space queries (= $1) never visit.
ALTER TABLE channels ALTER COLUMN space_id DROP NOT NULL;
ALTER TABLE channels ADD COLUMN dm_key text UNIQUE;
ALTER TABLE channels ADD CONSTRAINT channels_dm_shape
    CHECK ((kind = 3) = (space_id IS NULL) AND (kind = 3) = (dm_key IS NOT NULL));

CREATE TABLE dm_members (
    channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX dm_members_user_idx ON dm_members (user_id);

-- A message in a DM notifies the other participant; no space to point at.
ALTER TABLE notifications ALTER COLUMN space_id DROP NOT NULL;
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_valid;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_kind_valid CHECK (kind IN ('mention', 'reply', 'dm'));

-- +goose Down
DELETE FROM notifications WHERE kind = 'dm';
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_valid;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_kind_valid CHECK (kind IN ('mention', 'reply'));
ALTER TABLE notifications ALTER COLUMN space_id SET NOT NULL;
DROP TABLE dm_members;
DELETE FROM channels WHERE kind = 3;
ALTER TABLE channels DROP CONSTRAINT channels_dm_shape;
ALTER TABLE channels DROP COLUMN dm_key;
ALTER TABLE channels ALTER COLUMN space_id SET NOT NULL;
