-- +goose Up
-- Owned by the chat module. The space role an invite grants when redeemed.
-- Capped at the creator's own role, at creation and again at join; owner is
-- never granted by invite (ownership only moves by transfer).
ALTER TABLE invites
    ADD COLUMN role text NOT NULL DEFAULT 'member'
        CONSTRAINT invites_role_valid CHECK (role IN ('admin', 'member'));

-- +goose Down
ALTER TABLE invites DROP COLUMN role;
