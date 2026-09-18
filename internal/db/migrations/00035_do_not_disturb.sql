-- +goose Up
-- Owned by the auth module. Do not disturb belongs to the account, so every
-- device a person uses follows it (docs/architecture/realtime.md).
-- dnd_until is when it ends on its own; NULL with dnd means until turned
-- off. A row past its dnd_until reads as off and is not swept. A bot is
-- never on do not disturb: there is no one to disturb.
ALTER TABLE users
    ADD COLUMN dnd       boolean NOT NULL DEFAULT false,
    ADD COLUMN dnd_until timestamptz,
    ADD CONSTRAINT users_dnd_until_needs_dnd CHECK (dnd OR dnd_until IS NULL),
    ADD CONSTRAINT users_bot_never_dnd CHECK (kind = 'person' OR NOT dnd);

-- +goose Down
ALTER TABLE users
    DROP CONSTRAINT users_bot_never_dnd,
    DROP CONSTRAINT users_dnd_until_needs_dnd,
    DROP COLUMN dnd_until,
    DROP COLUMN dnd;
