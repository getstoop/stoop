-- +goose Up
-- An admin can lock self-service renames on an account (after cleaning
-- up an offensive handle, say). Admin renames bypass the lock.
ALTER TABLE users ADD COLUMN username_frozen boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE users DROP COLUMN username_frozen;
