-- +goose Up
-- Owned by the chat module. The alert count on a channel (CountAlerts)
-- finds the replies to a person's own messages, and that starts from
-- their messages: without this, every channel list scans the whole
-- messages table for one author. Expand only: the previous release
-- ignores it. A plain build, about a third of a second per million rows,
-- and nothing else writes during migration.
CREATE INDEX messages_author_idx ON messages (author_id, id DESC);

-- +goose Down
DROP INDEX messages_author_idx;
