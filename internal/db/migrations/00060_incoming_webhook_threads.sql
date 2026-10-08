-- +goose Up
-- Owned by the integrations module. An incoming webhook's thread keys
-- (STOOP-437): the first post with a key starts a thread, later ones reply
-- in it. A key goes with its root, so the next post after a delete or a
-- sweep starts a new thread. docs/architecture/integrations.md.
CREATE TABLE incoming_webhook_threads (
    webhook_id      uuid NOT NULL REFERENCES incoming_webhooks (id) ON DELETE CASCADE,
    thread_key      text NOT NULL,
    root_message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (webhook_id, thread_key)
);

-- Deleting a root (Delete thread, the retention sweep) finds its keys by
-- root; the primary key leads with the hook.
CREATE INDEX incoming_webhook_threads_root_idx ON incoming_webhook_threads (root_message_id);

-- +goose Down
DROP TABLE incoming_webhook_threads;
