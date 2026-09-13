-- +goose Up
-- Owned by the auth module. Every way of presenting yourself: sessions now;
-- personal tokens, bot tokens and incoming hooks later. grants is NULL only
-- for a session, which covers every action. See
-- docs/proposals/access-model.md.
CREATE TABLE credentials (
    id           uuid PRIMARY KEY,
    holder_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind         text NOT NULL
                 CHECK (kind IN ('session', 'personal_token', 'bot_token', 'incoming_hook')),
    token_hash   bytea NOT NULL UNIQUE,
    name         text NOT NULL DEFAULT '',
    grants       text[],
    bounded      boolean NOT NULL DEFAULT false,
    created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz,
    last_used_at timestamptz,
    CHECK ((kind = 'session') = (grants IS NULL)),
    CHECK (kind <> 'session' OR NOT bounded)
);
CREATE INDEX credentials_holder_idx ON credentials (holder_id, kind);

-- Owned by the auth module. What a bounded credential may reach: one space
-- or one channel per row. Rows cascade with their space or channel, and a
-- bounded credential left with none reaches nothing.
CREATE TABLE credential_bounds (
    credential_id uuid NOT NULL REFERENCES credentials (id) ON DELETE CASCADE,
    space_id      uuid REFERENCES spaces (id) ON DELETE CASCADE,
    channel_id    uuid REFERENCES channels (id) ON DELETE CASCADE,
    CHECK (num_nonnulls(space_id, channel_id) = 1)
);
CREATE UNIQUE INDEX credential_bounds_uniq
    ON credential_bounds (credential_id, coalesce(space_id, channel_id));

-- Owned by the auth module.
ALTER TABLE users ADD COLUMN kind text NOT NULL DEFAULT 'person'
    CHECK (kind IN ('person', 'bot'));

-- Expand: live sessions carry over with their ids and hashes, so nobody is
-- signed out. sessions stays for the previous release; a later contract
-- migration drops it.
INSERT INTO credentials (id, holder_id, kind, token_hash, created_at, expires_at)
SELECT id, user_id, 'session', token_hash, created_at, expires_at
FROM sessions
WHERE expires_at > now();

-- +goose Down
ALTER TABLE users DROP COLUMN kind;
DROP TABLE credential_bounds;
DROP TABLE credentials;
