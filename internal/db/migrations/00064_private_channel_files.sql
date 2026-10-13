-- +goose Up
-- Owned by the files module. An attachment uploaded for a private
-- channel names it, and is served to that channel's people only. A
-- public channel's files leave it NULL and are served by space, as before.
ALTER TABLE files ADD COLUMN private_channel_id uuid REFERENCES channels (id) ON DELETE CASCADE;

-- +goose Down
ALTER TABLE files DROP COLUMN private_channel_id;
