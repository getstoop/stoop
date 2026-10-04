-- +goose Up
-- Owned by the auth module. Contract: nothing has read sessions since
-- 0.2.0, which moved them into credentials (00031). A session a
-- rolled-back 0.1.0 signed in since then carries over the same way before
-- the table goes. 0.1.0 can no longer start against this schema, so the
-- floor rises to 0.2.0's last migration (docs/architecture/data.md →
-- Upgrades and rollback).
INSERT INTO credentials (id, holder_id, kind, token_hash, created_at, expires_at)
SELECT id, user_id, 'session', token_hash, created_at, expires_at
FROM sessions
WHERE expires_at > now()
ON CONFLICT DO NOTHING;

DROP TABLE sessions;

UPDATE schema_floor SET min_migration = 37;

-- +goose Down
UPDATE schema_floor SET min_migration = 0;

CREATE TABLE sessions (
    id         uuid PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
