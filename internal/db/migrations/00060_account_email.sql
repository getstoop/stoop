-- +goose Up
-- Owned by the auth module. An optional email address per account:
-- email holds a confirmed address only, pending_email one waiting for its
-- link. See docs/architecture/identity.md → Email address.
ALTER TABLE users
    ADD COLUMN email              citext,
    ADD COLUMN email_confirmed_at timestamptz,
    ADD COLUMN pending_email      citext,
    ADD COLUMN pending_email_at   timestamptz;

CREATE UNIQUE INDEX users_email_unique ON users (email) WHERE email IS NOT NULL;

-- Owned by the auth module. Single-use link tokens; only the SHA-256 of
-- the token is stored.
CREATE TABLE email_tokens (
    id         uuid PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purpose    text NOT NULL CHECK (purpose IN ('confirm_email')),
    token_hash bytea NOT NULL UNIQUE,
    address    citext NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at    timestamptz
);

CREATE INDEX email_tokens_user ON email_tokens (user_id, purpose);

-- +goose Down
DROP TABLE email_tokens;
DROP INDEX users_email_unique;
ALTER TABLE users
    DROP COLUMN email,
    DROP COLUMN email_confirmed_at,
    DROP COLUMN pending_email,
    DROP COLUMN pending_email_at;
