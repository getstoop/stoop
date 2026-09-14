-- +goose Up
-- Owned by the auth module. A bot never holds the instance admin role
-- (decided 2026-09-14): its reach is the spaces an admin has put it in,
-- and the instance actions belong to a person's own token. Any bot that
-- was promoted before this is a member again.
UPDATE users SET role = 'member' WHERE kind = 'bot' AND role = 'admin';
ALTER TABLE users ADD CONSTRAINT users_bot_never_admin
    CHECK (kind = 'person' OR role = 'member');

-- +goose Down
ALTER TABLE users DROP CONSTRAINT users_bot_never_admin;
