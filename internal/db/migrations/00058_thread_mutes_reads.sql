-- +goose Up
-- Owned by the chat module. A person's own mute for one thread, and how far
-- they have read it (STOOP-433). Who is in a thread is worked out from its
-- messages; these hold only what the person chose or saw.
-- docs/architecture/messaging.md#threads.
CREATE TABLE thread_mutes (
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    root_message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, root_message_id)
);

CREATE TABLE thread_reads (
    user_id              uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    root_message_id      uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    last_read_message_id uuid NOT NULL,
    updated_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, root_message_id)
);

-- Deleting a root (Delete thread, the retention sweep) finds its rows by
-- root; the primary keys lead with the person.
CREATE INDEX thread_mutes_root_idx ON thread_mutes (root_message_id);
CREATE INDEX thread_reads_root_idx ON thread_reads (root_message_id);

-- +goose Down
DROP TABLE thread_reads;
DROP TABLE thread_mutes;
