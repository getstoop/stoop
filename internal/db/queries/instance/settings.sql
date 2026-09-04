-- Instance settings. Owned by the instance module.
-- Only internal/instance may use these queries.

-- name: GetSetting :one
SELECT value FROM instance_settings WHERE key = $1;

-- name: UpsertSetting :exec
INSERT INTO instance_settings (key, value)
VALUES ($1, $2)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- SeedSetting only inserts when the key is absent (first boot).
-- name: SeedSetting :exec
INSERT INTO instance_settings (key, value)
VALUES ($1, $2)
ON CONFLICT (key) DO NOTHING;
