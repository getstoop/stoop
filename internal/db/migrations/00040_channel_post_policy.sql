-- +goose Up
-- Who may post in a text channel: everyone, or only its space's admins,
-- owner and bots (an announcement channel). See
-- docs/architecture/messaging.md#announcement-channels.
ALTER TABLE channels
  ADD COLUMN post_policy text NOT NULL DEFAULT 'everyone'
  CHECK (post_policy IN ('everyone', 'admins'));

-- +goose Down
ALTER TABLE channels DROP COLUMN post_policy;
