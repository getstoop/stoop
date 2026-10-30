-- +goose Up
-- Owned by the chat module. A label names an invite for the people who
-- list them ("Tuesday book club"); the joiner never sees it. An
-- invite_uses row records each join through an invite, so the list can
-- say who came in on which one; leaving and rejoining through the same
-- code is another row. Expand only: the previous release ignores both.
ALTER TABLE invites ADD COLUMN label text NOT NULL DEFAULT ''
    CONSTRAINT invites_label_len CHECK (char_length(label) <= 60);

CREATE TABLE invite_uses (
    id        uuid PRIMARY KEY,
    invite_id uuid NOT NULL REFERENCES invites (id) ON DELETE CASCADE,
    user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    used_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invite_uses_invite_idx ON invite_uses (invite_id, used_at DESC);

-- +goose Down
DROP TABLE invite_uses;
ALTER TABLE invites DROP COLUMN label;
