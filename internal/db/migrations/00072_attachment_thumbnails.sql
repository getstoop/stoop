-- +goose Up
-- Owned by the files module. An image attachment's thumbnail is a files
-- row of kind attachment_thumbnail pointing at its original, made by the
-- thumbnail_attachment job; deleting the original's row takes it. At
-- most one per original, which also indexes the column for that cascade
-- and for the lookups by original.
ALTER TABLE files ADD COLUMN thumbnail_of uuid REFERENCES files (id) ON DELETE CASCADE;
CREATE UNIQUE INDEX files_thumbnail_of_idx ON files (thumbnail_of) WHERE thumbnail_of IS NOT NULL;

-- +goose Down
DROP INDEX files_thumbnail_of_idx;
ALTER TABLE files DROP COLUMN thumbnail_of;
