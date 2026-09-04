-- +goose Up
-- Owned by the chat module. Space-level role: owner > admin > member, with
-- a fixed in-code permission table (docs/architecture/permissions.md).
ALTER TABLE space_members
    ADD COLUMN role text NOT NULL DEFAULT 'member'
        CONSTRAINT space_members_role_valid CHECK (role IN ('owner', 'admin', 'member'));

-- Backfill: the existing spaces.owner_id is the owner.
UPDATE space_members m
SET role = 'owner'
FROM spaces s
WHERE s.id = m.space_id AND s.owner_id = m.user_id;

-- Exactly one owner per space.
CREATE UNIQUE INDEX space_members_one_owner_idx ON space_members (space_id) WHERE role = 'owner';

-- Whether plain members may create invites (admins and the owner always can).
ALTER TABLE spaces
    ADD COLUMN members_can_invite boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE spaces DROP COLUMN members_can_invite;
DROP INDEX space_members_one_owner_idx;
ALTER TABLE space_members DROP COLUMN role;
