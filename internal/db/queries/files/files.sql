-- Stored file metadata. Owned by the files module.
-- Only internal/files may use these queries.

-- name: CreateFile :one
INSERT INTO files (id, kind, owner_id, space_id, content_type, size, sha256, storage_key, name, private_channel_id, width, height)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, sqlc.narg(private_channel_id), sqlc.narg(width), sqlc.narg(height))
RETURNING *;

-- CreatePendingFile stores an avatar or icon upload as sent; the
-- normalise_image job readies it. The row is never served while pending.
-- name: CreatePendingFile :one
INSERT INTO files (id, kind, owner_id, space_id, content_type, size, sha256, storage_key, name, pending)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '', true)
RETURNING *;

-- ReadyPendingFile records the normalised bytes and clears pending; no row
-- comes back when the file is gone or was already readied.
-- name: ReadyPendingFile :one
UPDATE files SET pending = false, content_type = sqlc.arg(content_type), size = sqlc.arg(size), sha256 = sqlc.arg(sha256)
WHERE id = sqlc.arg(id) AND pending
RETURNING *;

-- name: GetFilesByIDs :many
SELECT * FROM files WHERE id = ANY($1::uuid[]);

-- DeleteFilesByIDs takes the files' thumbnails too, returned with them
-- so their blobs go as well (the cascade would take only the rows).
-- name: DeleteFilesByIDs :many
DELETE FROM files WHERE id = ANY($1::uuid[]) OR thumbnail_of = ANY($1::uuid[]) RETURNING *;

-- CreateThumbnail records an attachment's thumbnail. It is not checked
-- against the quota: the upload it was made from was. No row comes back
-- when the original already has one.
-- name: CreateThumbnail :one
INSERT INTO files (id, kind, owner_id, space_id, content_type, size, sha256, storage_key, name, thumbnail_of, width, height)
VALUES ($1, 'attachment_thumbnail', $2, $3, $4, $5, $6, $7, '', sqlc.arg(thumbnail_of)::uuid, sqlc.arg(width)::integer, sqlc.arg(height)::integer)
ON CONFLICT (thumbnail_of) WHERE thumbnail_of IS NOT NULL DO NOTHING
RETURNING *;

-- ListThumbnailsOf answers which of these originals have a thumbnail.
-- name: ListThumbnailsOf :many
SELECT id, thumbnail_of::uuid AS original_id FROM files WHERE thumbnail_of = ANY(sqlc.arg(ids)::uuid[]);

-- DeleteThumbnailsOf removes the thumbnails of originals that are
-- expiring, and returns their keys for the blobs.
-- name: DeleteThumbnailsOf :many
DELETE FROM files WHERE thumbnail_of = ANY(sqlc.arg(ids)::uuid[]) RETURNING storage_key;

-- name: GetFile :one
SELECT * FROM files WHERE id = $1;

-- name: DeleteFile :one
DELETE FROM files WHERE id = $1 RETURNING *;

-- The sweep pages through files older than a grace period by id. A
-- thumbnail is left out while its original is live: nothing points at it
-- but the original, which takes it when it goes.
-- name: ListFilesOlderThan :many
SELECT * FROM files
WHERE files.created_at < sqlc.arg(before) AND files.id > sqlc.arg(after_id)
  AND NOT EXISTS (
    SELECT 1 FROM files original
    WHERE original.id = files.thumbnail_of AND original.expired_at IS NULL
  )
ORDER BY files.id
LIMIT sqlc.arg('limit');

-- name: ListStorageKeysAmong :many
SELECT storage_key FROM files WHERE storage_key = ANY(sqlc.arg(keys)::text[]);

-- name: StorageUsage :one
SELECT COALESCE(SUM(size), 0)::bigint AS bytes, count(*)::bigint AS files FROM files
WHERE expired_at IS NULL;

-- LockStorageQuota serialises quota-checked inserts for the transaction
-- (see files.recordFile). The key is arbitrary and only used here.
-- name: LockStorageQuota :exec
SELECT pg_advisory_xact_lock(4207011);

-- Attachment retention: attachments uploaded before the cutoff that
-- haven't expired, less the ones kept (pinned messages' files), oldest
-- first.
-- name: ListExpiringAttachments :many
SELECT id, storage_key FROM files
WHERE kind = 'attachment' AND expired_at IS NULL
  AND created_at < sqlc.arg(before)
  AND NOT (id = ANY(sqlc.arg(keep)::uuid[]))
ORDER BY created_at
LIMIT sqlc.arg('limit');

-- CountExpiringAttachments counts the originals, and their bytes with
-- their thumbnails'.
-- name: CountExpiringAttachments :one
WITH expiring AS (
  SELECT original.id, original.size FROM files original
  WHERE original.kind = 'attachment' AND original.expired_at IS NULL
    AND original.created_at < sqlc.arg(before)
    AND NOT (original.id = ANY(sqlc.arg(keep)::uuid[]))
)
SELECT count(*)::bigint AS files,
  (COALESCE(SUM(expiring.size), 0) + COALESCE((
    SELECT SUM(thumbnail.size) FROM files thumbnail
    WHERE thumbnail.thumbnail_of IN (SELECT expiring.id FROM expiring)
  ), 0))::bigint AS bytes
FROM expiring;

-- ExpireFiles marks files expired and drops their names; the blobs are
-- already gone.
-- name: ExpireFiles :exec
UPDATE files SET expired_at = now(), name = '' WHERE id = ANY(sqlc.arg(ids)::uuid[]);
