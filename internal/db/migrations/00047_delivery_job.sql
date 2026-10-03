-- +goose Up
-- webhook_deliveries (integrations): the id of the job that performs the
-- delivery, so the hook sweep can finish a row whose job is lost.
ALTER TABLE webhook_deliveries ADD COLUMN job_id uuid;

-- +goose Down
ALTER TABLE webhook_deliveries DROP COLUMN job_id;
