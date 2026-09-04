-- +goose Up
-- Owned by the files module: one row per stored blob. storage_key is the
-- blob store key ({kind}/{id}); the bytes live in the blob store, never
-- here. kind is avatar | space_icon | attachment (attachments: phase 2).
CREATE TABLE files (
    id           uuid PRIMARY KEY,
    kind         text NOT NULL,
    owner_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    space_id     uuid REFERENCES spaces (id) ON DELETE CASCADE,
    content_type text NOT NULL,
    size         bigint NOT NULL,
    sha256       bytea NOT NULL,
    storage_key  text NOT NULL UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_owner_idx ON files (owner_id);
CREATE INDEX files_space_idx ON files (space_id) WHERE space_id IS NOT NULL;

-- Users (auth) and spaces (chat) point at their current avatar / icon.
-- Deleting the file row clears the pointer; the modules replace the
-- pointer first and delete the old file afterwards.
ALTER TABLE users ADD COLUMN avatar_file_id uuid REFERENCES files (id) ON DELETE SET NULL;
ALTER TABLE spaces ADD COLUMN icon_file_id uuid REFERENCES files (id) ON DELETE SET NULL;

-- +goose Down
ALTER TABLE spaces DROP COLUMN icon_file_id;
ALTER TABLE users DROP COLUMN avatar_file_id;
DROP TABLE files;
