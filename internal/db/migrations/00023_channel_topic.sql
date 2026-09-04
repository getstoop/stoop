-- +goose Up
-- One line saying what a channel is for, shown in its header. Empty for
-- a direct message, which has no name to explain either.
ALTER TABLE channels ADD COLUMN topic text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE channels DROP COLUMN topic;
