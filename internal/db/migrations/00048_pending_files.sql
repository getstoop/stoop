-- +goose Up
-- files (files): an avatar or icon upload is stored as sent and marked
-- pending until the normalise_image job has re-encoded it. A pending file
-- is not served and nothing points at it yet.
ALTER TABLE files ADD COLUMN pending boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE files DROP COLUMN pending;
