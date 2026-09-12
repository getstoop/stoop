-- +goose Up
-- Group DMs: a direct message with more than two people. Owned by the chat
-- module. See docs/proposals/group-dms.md. dm_members already held a list,
-- so nothing moves and nothing backfills.
--
-- The one thing in the way was dm_key, the pair identity that makes "open
-- a DM with X" idempotent. A group is not identified by who is in it —
-- people are added and leave — so a group carries no key, and the check
-- that demanded one on every DM now only forbids one on a channel that is
-- not a DM. The new constraint accepts everything the old one did, so the
-- previous release runs against this unchanged.
ALTER TABLE channels DROP CONSTRAINT channels_dm_shape;
ALTER TABLE channels ADD CONSTRAINT channels_dm_shape
    CHECK ((kind = 3) = (space_id IS NULL) AND (kind = 3 OR dm_key IS NULL));

-- +goose Down
-- Group conversations cannot satisfy the old constraint, so rolling back
-- past this discards them. Pair DMs are untouched.
DELETE FROM channels WHERE kind = 3 AND dm_key IS NULL;
ALTER TABLE channels DROP CONSTRAINT channels_dm_shape;
ALTER TABLE channels ADD CONSTRAINT channels_dm_shape
    CHECK ((kind = 3) = (space_id IS NULL) AND (kind = 3) = (dm_key IS NOT NULL));
