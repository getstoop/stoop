-- +goose Up
-- Owned by the integrations module. See docs/architecture/integrations.md.

-- A URL we host. The token is a credentials row; NULL means disabled.
CREATE TABLE incoming_webhooks (
    id              uuid PRIMARY KEY,
    space_id        uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    channel_id      uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    bot_user_id     uuid NOT NULL REFERENCES users (id),
    credential_id   uuid UNIQUE REFERENCES credentials (id) ON DELETE SET NULL,
    name            text NOT NULL,
    created_by      uuid NOT NULL REFERENCES users (id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    disabled_at     timestamptz,
    disabled_reason text NOT NULL DEFAULT ''
);

-- A URL they host. channel_id is an optional filter.
CREATE TABLE outgoing_webhooks (
    id              uuid PRIMARY KEY,
    space_id        uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    channel_id      uuid REFERENCES channels (id) ON DELETE SET NULL,
    url             text NOT NULL,
    secret          bytea NOT NULL,
    event_types     text[] NOT NULL DEFAULT '{}',
    sequence        bigint NOT NULL DEFAULT 0,
    name            text NOT NULL,
    created_by      uuid NOT NULL REFERENCES users (id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    disabled_at     timestamptz,
    disabled_reason text NOT NULL DEFAULT ''
);

CREATE INDEX incoming_webhooks_space_idx ON incoming_webhooks (space_id);
CREATE INDEX outgoing_webhooks_space_idx ON outgoing_webhooks (space_id);

-- The Postgres queue: a queued row is work, a finished row is the log.
CREATE TABLE webhook_deliveries (
    id           uuid PRIMARY KEY,
    lane         uuid NOT NULL REFERENCES outgoing_webhooks (id) ON DELETE CASCADE,
    event_type   text NOT NULL,
    sequence     bigint NOT NULL,
    body         bytea,
    attempts     int NOT NULL DEFAULT 0,
    not_before   timestamptz NOT NULL DEFAULT now(),
    leased_until timestamptz,
    finished_at  timestamptz,
    status_code  int,
    response     text NOT NULL DEFAULT '',
    error        text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (not_before, sequence)
    WHERE finished_at IS NULL;
CREATE INDEX webhook_deliveries_log_idx ON webhook_deliveries (lane, created_at DESC);

-- +goose Down
DROP TABLE webhook_deliveries;
DROP TABLE outgoing_webhooks;
DROP TABLE incoming_webhooks;
