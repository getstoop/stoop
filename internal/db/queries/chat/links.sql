-- Link previews. Owned by the chat module.

-- EnsureLinkPreview creates a pending row for a URL nobody has linked
-- before; an existing row is left alone.
-- name: EnsureLinkPreview :exec
INSERT INTO link_previews (url) VALUES ($1)
ON CONFLICT (url) DO NOTHING;

-- name: GetLinkPreview :one
SELECT * FROM link_previews WHERE url = $1;

-- name: SetLinkPreview :exec
UPDATE link_previews
SET state = $2, fetched_at = now(), title = $3, description = $4, site_name = $5,
    image_file_id = $6, image_width = $7, image_height = $8
WHERE url = $1;

-- name: InsertMessageLink :exec
INSERT INTO message_links (message_id, position, url) VALUES ($1, $2, $3);

-- name: DeleteMessageLinks :exec
DELETE FROM message_links WHERE message_id = $1;

-- name: ListLinkPreviewsForMessages :many
SELECT ml.message_id, ml.position, p.*
FROM message_links ml
JOIN link_previews p ON p.url = ml.url
WHERE ml.message_id = ANY($1::uuid[]) AND p.state = 'ok'
ORDER BY ml.message_id, ml.position;
