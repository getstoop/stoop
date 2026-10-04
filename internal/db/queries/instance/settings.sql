-- Instance settings. Owned by the instance module.
-- Only internal/instance may use these queries.

-- name: GetSetting :one
SELECT value FROM instance_settings WHERE key = $1;

-- name: UpsertSetting :exec
INSERT INTO instance_settings (key, value)
VALUES ($1, $2)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- SeedSetting only inserts when the key is absent.
-- name: SeedSetting :exec
INSERT INTO instance_settings (key, value)
VALUES ($1, $2)
ON CONFLICT (key) DO NOTHING;

-- DeleteSetting removes a saved value, so the next start seeds it from the
-- environment again (stoop admin setting reset).
-- name: DeleteSetting :execrows
DELETE FROM instance_settings WHERE key = $1;
