-- +goose Up
-- Owned by the auth module. The server owner: one account nobody can
-- demote, deactivate or reset through the API, handed on only by the owner
-- or `stoop admin transfer-owner` (docs/architecture/identity.md → The
-- server owner). The constraint keeps the owner an active person admin
-- whatever code path writes the row; the index allows one at most.
ALTER TABLE users
    ADD COLUMN is_owner boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT users_owner_is_active_admin
        CHECK (NOT is_owner OR (role = 'admin' AND kind = 'person' AND deactivated_at IS NULL));
CREATE UNIQUE INDEX users_one_owner ON users ((true)) WHERE is_owner;

-- A server from before this has admins and no owner: the longest-serving
-- active admin becomes it.
UPDATE users SET is_owner = true
WHERE id = (
    SELECT id FROM users
    WHERE role = 'admin' AND kind = 'person' AND deactivated_at IS NULL
    ORDER BY created_at, id
    LIMIT 1
);

-- +goose Down
DROP INDEX users_one_owner;
ALTER TABLE users
    DROP CONSTRAINT users_owner_is_active_admin,
    DROP COLUMN is_owner;
