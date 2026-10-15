-- +goose Up
-- Owned by the chat module. A link's card that the message's author, or a
-- moderator, dismissed: the row stays so an edit keeps the dismissal, and
-- the card is no longer listed.
ALTER TABLE message_links ADD COLUMN dismissed boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE message_links DROP COLUMN dismissed;
