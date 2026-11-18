-- +goose Up
-- Owned by the push module. push_keys is the server's one signing key pair
-- for push (RFC 8292): the private key as PKCS #8 DER and its public point
-- uncompressed, made on first use. push_subscriptions is at most one
-- registration per signed-in session; it goes with its session (sign-out,
-- revoke, expiry sweep). kinds are chat.v1.ActivityKind numbers. Expand
-- only: the previous release ignores both.
CREATE TABLE push_keys (
    id          boolean PRIMARY KEY DEFAULT true CHECK (id),
    private_key bytea NOT NULL,
    public_key  bytea NOT NULL CHECK (octet_length(public_key) = 65),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_subscriptions (
    id              uuid PRIMARY KEY,
    credential_id   uuid NOT NULL UNIQUE REFERENCES credentials (id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    endpoint        text NOT NULL CHECK (char_length(endpoint) <= 2048),
    p256dh          bytea NOT NULL CHECK (octet_length(p256dh) = 65),
    auth            bytea NOT NULL CHECK (octet_length(auth) = 16),
    local_server_id text NOT NULL CHECK (char_length(local_server_id) BETWEEN 1 AND 32),
    kinds           integer[] NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_success_at timestamptz,
    failures        integer NOT NULL DEFAULT 0
);

CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- +goose Down
DROP TABLE push_subscriptions;
DROP TABLE push_keys;
