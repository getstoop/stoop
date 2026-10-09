-- The outbound email cap: one fixed one-hour window in the settings row
-- smtp_send_window ({start, count}). Owned by the instance module.

-- TakeSendSlot counts one send, starting a new window when the saved one
-- started at or before expired_before (an hour ago). No row comes back
-- when the window is full.
-- name: TakeSendSlot :one
INSERT INTO instance_settings (key, value)
VALUES ('smtp_send_window', jsonb_build_object('start', @now::timestamptz, 'count', 1))
ON CONFLICT (key) DO UPDATE SET
    value = CASE
        WHEN (instance_settings.value->>'start')::timestamptz <= @expired_before::timestamptz
            THEN jsonb_build_object('start', @now::timestamptz, 'count', 1)
        ELSE jsonb_set(instance_settings.value, '{count}',
            to_jsonb((instance_settings.value->>'count')::int + 1))
    END,
    updated_at = now()
WHERE (instance_settings.value->>'start')::timestamptz <= @expired_before::timestamptz
   OR (instance_settings.value->>'count')::int < @hourly_limit::int
RETURNING value;
