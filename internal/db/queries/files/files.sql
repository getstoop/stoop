-- Stored file metadata. Owned by the files module.
-- Only internal/files may use these queries.

-- name: CreateFile :one
INSERT INTO files (id, kind, owner_id, space_id, content_type, size, sha256, storage_key, name)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: GetFilesByIDs :many
SELECT * FROM files WHERE id = ANY($1::uuid[]);

-- name: DeleteFilesByIDs :many
DELETE FROM files WHERE id = ANY($1::uuid[]) RETURNING *;

-- name: GetFile :one
SELECT * FROM files WHERE id = $1;

-- name: DeleteFile :one
DELETE FROM files WHERE id = $1 RETURNING *;

-- The sweep pages through files older than a grace period by id.
-- name: ListFilesOlderThan :many
SELECT * FROM files
WHERE created_at < sqlc.arg(before) AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg('limit');

-- name: ListStorageKeysAmong :many
SELECT storage_key FROM files WHERE storage_key = ANY(sqlc.arg(keys)::text[]);

-- name: StorageUsage :one
SELECT COALESCE(SUM(size), 0)::bigint AS bytes, count(*)::bigint AS files FROM files;
