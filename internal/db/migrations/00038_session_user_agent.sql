-- +goose Up
-- Owned by the auth module. The browser or app a session was signed in
-- from, as it described itself, so a person can tell their sessions apart
-- (docs/architecture/identity.md → Sessions). Empty for other credentials
-- and for sessions from before this column.
ALTER TABLE credentials ADD COLUMN user_agent text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE credentials DROP COLUMN user_agent;
