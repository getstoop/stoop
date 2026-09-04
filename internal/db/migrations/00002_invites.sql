-- +goose Up
-- Owned by the chat module. An invite is a short shareable code that grants
-- membership in a space. Validity is checked at join time: not revoked, not
-- past expires_at (NULL = never), and use_count < max_uses (NULL = unlimited).
CREATE TABLE invites (
    id         uuid PRIMARY KEY,
    space_id   uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    code       text NOT NULL UNIQUE,
    created_by uuid NOT NULL REFERENCES users (id),
    expires_at timestamptz,
    max_uses   int,
    use_count  int NOT NULL DEFAULT 0,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT invites_max_uses_positive CHECK (max_uses IS NULL OR max_uses > 0),
    CONSTRAINT invites_use_count_nonneg CHECK (use_count >= 0)
);

CREATE INDEX invites_space_idx ON invites (space_id, created_at DESC);

-- +goose Down
DROP TABLE invites;
