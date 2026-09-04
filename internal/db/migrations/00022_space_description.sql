-- +goose Up
-- A space says what it is: description is the one line an invite shows a
-- stranger and the sidebar shows under the name; welcome is the markdown
-- a new member reads on arrival. Only description is public.
ALTER TABLE spaces
    ADD COLUMN description text NOT NULL DEFAULT '',
    ADD COLUMN welcome text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE spaces DROP COLUMN description, DROP COLUMN welcome;
