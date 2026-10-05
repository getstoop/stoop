-- +goose Up
-- Owned by the integrations module. Contract: 0.5.0 stopped storing a
-- receiver's reply (STOOP-350); 0.4.x still writes this column, so the
-- floor rises to 0.5.0's last migration and refuses it (STOOP-415).
ALTER TABLE webhook_deliveries DROP COLUMN response;

UPDATE schema_floor SET min_migration = 53;

-- +goose Down
UPDATE schema_floor SET min_migration = 52;

ALTER TABLE webhook_deliveries ADD COLUMN response text NOT NULL DEFAULT '';
