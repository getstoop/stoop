-- +goose Up
-- Owned by the chat module. The contract half of the channel log
-- (docs/proposals/channel-log.md): 00068 added messages.seq nullable and
-- every write since 0.14.0 stamps it, so this release makes it NOT NULL.
--
-- Backfill first. A row with no seq was written by a 0.13.0 binary during
-- a rollback from 0.14.0 (0.13.0 knows nothing of the column). Unlike
-- 00068's rank-by-id fill, these rows take positions above the channel's
-- current counter, in id order, and the counter moves up past them: a
-- client holding the channel at its old seq sees them in its next
-- ListChanges only if their seq is higher than what it holds. One
-- statement, so inside goose's transaction the counter the fill reads
-- and the counter it advances are the same snapshot; the channels moved
-- are exactly those that had such rows.
WITH filled AS (
    UPDATE messages m SET seq = c.seq + numbered.rank
    FROM (
        SELECT id, channel_id, row_number() OVER (PARTITION BY channel_id ORDER BY id) AS rank
        FROM messages
        WHERE seq IS NULL
    ) numbered
    JOIN channels c ON c.id = numbered.channel_id
    WHERE m.id = numbered.id
    RETURNING m.channel_id, m.seq
)
UPDATE channels c SET seq = highest.seq
FROM (SELECT channel_id, max(seq) AS seq FROM filled GROUP BY channel_id) highest
WHERE c.id = highest.channel_id;

-- The view message_with_reply reads m.seq and needs no recreation: a
-- constraint on the column is not a change to the view's definition.
ALTER TABLE messages ALTER COLUMN seq SET NOT NULL;

-- The floor goes to the last migration the previous release shipped
-- (internal/db/db.go, checkSchemaFloor): 0.14.0 shipped 68, and its code
-- always writes messages.seq, so it still runs against this schema;
-- 0.13.0 (newest 67) never writes the column and is refused. 00065 set
-- the floor to its own number because the release before it could not
-- run at all against a renamed column; here the previous release can, so
-- 68, not 69.
UPDATE schema_floor SET min_migration = 68;

-- channels.swept_seq is written by nothing from this release on (the
-- sweep's UPDATE went with it) and read by nothing since 00068. It stays
-- this release because 0.14.0's sweep still writes it; the release after
-- this one drops it, once no shipped binary does.

-- +goose Down
UPDATE schema_floor SET min_migration = 65;
ALTER TABLE messages ALTER COLUMN seq DROP NOT NULL;
