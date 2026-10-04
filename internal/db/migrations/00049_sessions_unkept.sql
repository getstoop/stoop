-- +goose Up
-- Owned by internal/db (the migration runner). Contract with no schema
-- change: revocations stop clearing the legacy sessions table, so 0.1.0,
-- the one release that reads it, could bring a revoked session back. The
-- floor refuses it. The table stays because 0.2.0 to 0.3.x still delete
-- from it; STOOP-409 drops it a release later.
UPDATE schema_floor SET min_migration = 37;

-- +goose Down
UPDATE schema_floor SET min_migration = 0;
