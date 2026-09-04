-- +goose Up
-- What a person says about themselves: pronouns beside their name and a
-- short bio, both shown on their profile card and nowhere else.
ALTER TABLE users
    ADD COLUMN pronouns text NOT NULL DEFAULT '',
    ADD COLUMN bio      text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE users DROP COLUMN pronouns, DROP COLUMN bio;
