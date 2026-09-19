-- The Diagnostics tab's Database panel: one round trip, this database
-- only. Owned by the instance module.

-- name: GetDatabaseFacts :one
SELECT
  pg_database_size(current_database())::bigint AS database_bytes,
  (SELECT count(*) FROM pg_catalog.pg_stat_activity
    WHERE datname = current_database() AND state = 'active')::int AS backends_active,
  (SELECT count(*) FROM pg_catalog.pg_stat_activity
    WHERE datname = current_database() AND state LIKE 'idle%')::int AS backends_idle,
  coalesce((SELECT (extract(epoch FROM max(now() - xact_start)) * 1000)::bigint
    FROM pg_catalog.pg_stat_activity
    WHERE datname = current_database() AND state = 'active'), 0)::bigint AS oldest_transaction_ms,
  current_setting('server_version')::text AS server_version,
  (SELECT coalesce(min(min_migration), 0) FROM schema_floor)::bigint AS schema_floor;
