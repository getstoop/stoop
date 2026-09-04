-- Owned by internal/db (the migration runner). See
-- docs/architecture/data.md → Upgrades and rollback.
-- +goose Up
CREATE TABLE schema_floor (
    min_migration bigint NOT NULL
);
INSERT INTO schema_floor (min_migration) VALUES (0);

-- +goose Down
DROP TABLE schema_floor;
