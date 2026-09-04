-- +goose Up
-- Owned by the instance module: admin-editable, runtime settings. Seeded
-- from the environment on first boot; the database is the source of truth
-- afterwards. Values are JSON so settings of any shape share one table.
CREATE TABLE instance_settings (
    key        text PRIMARY KEY,
    value      jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Owned by the auth module. A deactivated user can't log in and their
-- sessions are revoked; the row stays so their messages keep an author.
ALTER TABLE users ADD COLUMN deactivated_at timestamptz;

-- +goose Down
ALTER TABLE users DROP COLUMN deactivated_at;
DROP TABLE instance_settings;
