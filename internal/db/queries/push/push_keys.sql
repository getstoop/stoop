-- The push signing key. Owned by the push module.
-- Only internal/push may use these queries.

-- name: GetPushKey :one
SELECT private_key, public_key FROM push_keys WHERE id;

-- InsertPushKey keeps whichever key was stored first: a second server
-- racing to make one inserts nothing and reads the winner back.
-- name: InsertPushKey :exec
INSERT INTO push_keys (id, private_key, public_key)
VALUES (true, sqlc.arg(private_key)::bytea, sqlc.arg(public_key)::bytea)
ON CONFLICT (id) DO NOTHING;
