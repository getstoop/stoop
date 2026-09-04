-- +goose Up
-- Owned by the auth module. The instance-level role: admins operate the
-- server (settings, users) and inherit admin in every space; see
-- docs/architecture/permissions.md. The first registered user becomes
-- admin (see auth.Register).
ALTER TABLE users
    ADD COLUMN role text NOT NULL DEFAULT 'member'
        CONSTRAINT users_role_valid CHECK (role IN ('admin', 'member'));

-- +goose Down
ALTER TABLE users DROP COLUMN role;
