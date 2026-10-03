-- +goose Up
-- webhook_deliveries is the delivery log: one row per delivery, written by
-- the deliver_webhook job after each attempt. The queue is the jobs
-- module's. See docs/architecture/integrations.md.
DROP INDEX webhook_deliveries_due_idx;
ALTER TABLE webhook_deliveries
    RENAME COLUMN lane TO webhook_id;
ALTER TABLE webhook_deliveries
    DROP COLUMN not_before,
    DROP COLUMN leased_until;

-- +goose Down
ALTER TABLE webhook_deliveries
    ADD COLUMN not_before timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN leased_until timestamptz;
ALTER TABLE webhook_deliveries
    RENAME COLUMN webhook_id TO lane;
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (not_before, sequence)
    WHERE finished_at IS NULL;
