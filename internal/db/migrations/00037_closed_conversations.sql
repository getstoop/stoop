-- +goose Up
-- Owned by the chat module. Closing a conversation is one person's list
-- grooming (docs/architecture/messaging.md → Direct messages): their own
-- row says it is off their list, nobody else's changes, and the next
-- message clears it for everyone.
ALTER TABLE dm_members ADD COLUMN closed_at timestamptz;

-- +goose Down
ALTER TABLE dm_members DROP COLUMN closed_at;
