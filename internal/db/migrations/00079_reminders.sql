-- +goose Up
-- Owned by the chat module. Reminders (STOOP-553): a reminder waits here,
-- seen by nobody but the person who set it, until remind_at. The
-- deliver_reminders job then posts it in its channel as a messages row
-- of kind 9 and deletes this row (internal/chat/reminders.go).
-- docs/architecture/messaging.md → Reminders.
--
-- Additive: an older binary never reads the table. Deleting a channel
-- takes its waiting reminders with it. remind_at is a whole minute.
CREATE TABLE reminders (
    id         uuid PRIMARY KEY,
    channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users (id),
    content    text NOT NULL,
    remind_at  timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- The sweep reads what is due; the cap counts one person's.
CREATE INDEX reminders_due ON reminders (remind_at);
CREATE INDEX reminders_by_user ON reminders (user_id, remind_at);

-- +goose Down
-- Waiting reminders are lost with the table. A reminder already posted
-- stays: to the schema below this line it is a system row of a kind the
-- binary does not know, which it already reads.
DROP TABLE reminders;
