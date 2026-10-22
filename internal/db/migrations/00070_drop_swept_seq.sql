-- +goose Up
-- Owned by the chat module. channels.swept_seq goes
-- (docs/proposals/channel-log.md): 0.14.0's retention sweep wrote it,
-- nothing ever read it, and 0.15.0 stopped writing it.
--
-- Contract: 0.15.0's generated queries still name the column wherever
-- they read a channel row (sqlc expands channels.* and RETURNING * into
-- column lists), so a 0.15.0 binary against this schema fails on its
-- first channel query. The floor therefore goes to this migration's own
-- number, as 00065 did, not to the previous release's last migration as
-- 00069 did: 0.15.0 (newest 69) is refused rather than left to break,
-- and `stoop upgrade` says the rollback needs the backup it takes.
ALTER TABLE channels DROP COLUMN swept_seq;
UPDATE schema_floor SET min_migration = 70;

-- +goose Down
UPDATE schema_floor SET min_migration = 68;
ALTER TABLE channels ADD COLUMN swept_seq bigint NOT NULL DEFAULT 0;
