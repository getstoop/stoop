-- +goose Up
-- Owned by internal/db (the migration runner). Contract with no schema
-- change of its own: 00046 renamed webhook_deliveries.lane and dropped
-- not_before and leased_until, which 0.3.x reads, so 0.3.x must not start
-- against this schema (STOOP-414). The floor refuses it.
UPDATE schema_floor SET min_migration = 46;

-- +goose Down
UPDATE schema_floor SET min_migration = 37;
