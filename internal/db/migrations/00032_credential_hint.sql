-- +goose Up
-- Owned by the auth module. The last four characters of a credential's
-- token, so a list can tell tokens apart without storing the token. Empty
-- for sessions.
ALTER TABLE credentials ADD COLUMN hint text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE credentials DROP COLUMN hint;
