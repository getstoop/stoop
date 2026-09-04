-- +goose Up
-- Owned by the auth module: which external sign-ins (an OIDC provider's
-- subject) belong to which account. No provider tokens are ever stored.
CREATE TABLE user_identities (
    provider   text NOT NULL,
    subject    text NOT NULL,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    email      text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject),
    UNIQUE (user_id, provider)
);

-- An account created by a login provider has no password until its owner
-- sets one; "has a password" is a schema fact, not a sentinel hash.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
-- Set when the handle was derived from a provider claim; the owner may
-- change it once, then it is fixed like everyone else's.
ALTER TABLE users ADD COLUMN username_pending boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE users DROP COLUMN username_pending;
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
DROP TABLE user_identities;
