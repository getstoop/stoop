-- +goose Up
-- An attachment deleted by the attachment retention setting keeps its row,
-- without its name, so the message can still say a file was there. See
-- docs/architecture/files.md#retention.
ALTER TABLE files ADD COLUMN expired_at timestamptz;
CREATE INDEX files_attachment_age_idx ON files (created_at)
  WHERE kind = 'attachment' AND expired_at IS NULL;

-- +goose Down
DROP INDEX files_attachment_age_idx;
ALTER TABLE files DROP COLUMN expired_at;
