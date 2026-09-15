-- +goose Up
-- Owned by the auth module. A person may delete their own account
-- (docs/architecture/identity.md → Deleting your account). The row stays:
-- their messages keep their author, and the username stays held so nobody
-- can be impersonated by registering it again. A deleted account is a
-- deactivated one that never comes back.
ALTER TABLE users
    ADD COLUMN deleted_at timestamptz,
    ADD CONSTRAINT users_deleted_is_deactivated CHECK (deleted_at IS NULL OR deactivated_at IS NOT NULL);

-- +goose Down
ALTER TABLE users
    DROP CONSTRAINT users_deleted_is_deactivated,
    DROP COLUMN deleted_at;
