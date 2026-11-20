-- +goose Up
-- Owned by the push module. Why a subscription's last delivery failed and
-- when, for the Diagnostics tab's push row; failures already counts the
-- failed attempts since the last success. Never a reason to delete the
-- row: only the push service answering Gone does that. Expand only: the
-- previous release ignores both.
ALTER TABLE push_subscriptions
    ADD COLUMN last_failure_at timestamptz,
    ADD COLUMN last_failure    text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE push_subscriptions
    DROP COLUMN last_failure_at,
    DROP COLUMN last_failure;
