-- +goose Up
-- webhook_deliveries (integrations): the id of the job that performs the
-- delivery, so the hook sweep can finish a row whose job is lost. The
-- sweep reads the unfinished rows by age.
ALTER TABLE webhook_deliveries ADD COLUMN job_id uuid;
CREATE INDEX webhook_deliveries_unfinished_idx ON webhook_deliveries (created_at) WHERE finished_at IS NULL;

-- +goose Down
DROP INDEX webhook_deliveries_unfinished_idx;
ALTER TABLE webhook_deliveries DROP COLUMN job_id;
