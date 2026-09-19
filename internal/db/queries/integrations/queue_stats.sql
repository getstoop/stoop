-- The Background work panel's view of the queue, in one pass over
-- webhook_deliveries. A finished delivery is dead unless its status was
-- 2xx, the reading settleDead makes. The hook count is for the OFF state.
-- See docs/proposals/diagnostics.md.

-- name: QueueStats :one
SELECT
    count(*) FILTER (WHERE finished_at IS NULL
        AND (leased_until IS NULL OR leased_until < sqlc.arg(now)::timestamptz))::bigint AS queued,
    count(*) FILTER (WHERE finished_at IS NULL
        AND leased_until >= sqlc.arg(now)::timestamptz)::bigint AS leased,
    count(*) FILTER (WHERE finished_at IS NOT NULL
        AND (status_code IS NULL OR status_code NOT BETWEEN 200 AND 299))::bigint AS dead,
    count(*) FILTER (WHERE finished_at IS NOT NULL
        AND (status_code IS NULL OR status_code NOT BETWEEN 200 AND 299)
        AND finished_at >= sqlc.arg(since)::timestamptz)::bigint AS dead_last_hour,
    (SELECT count(*) FROM outgoing_webhooks)::bigint AS hooks
FROM webhook_deliveries;
