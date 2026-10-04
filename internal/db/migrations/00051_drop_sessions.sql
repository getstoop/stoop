-- +goose Up
-- Owned by the auth module. Contract: 0.4.0 stopped writing the legacy
-- sessions table (00049); 0.2.0 to 0.3.x still delete from it, so the
-- floor rises to 0.4.0's last migration and refuses them.
DROP TABLE sessions;

UPDATE schema_floor SET min_migration = 50;

-- +goose Down
UPDATE schema_floor SET min_migration = 37;

CREATE TABLE sessions (
    id         uuid PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
