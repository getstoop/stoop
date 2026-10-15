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
INSERT INTO message_links (message_id, position, url, dismissed) VALUES ($1, $2, $3, $4);

-- name: ListDismissedMessageLinks :many
SELECT url FROM message_links WHERE message_id = $1 AND dismissed;

-- LockMessageForLinks waits out an edit rebuilding the message's link
-- rows, which holds the message row from its content update onwards.
-- name: LockMessageForLinks :one
SELECT id FROM messages WHERE id = $1 FOR UPDATE;

-- DismissMessageLink hides a link's card on one message; no rows means
-- the message doesn't link the URL.
-- name: DismissMessageLink :execrows
UPDATE message_links SET dismissed = true WHERE message_id = $1 AND url = $2;

-- name: DeleteMessageLinks :exec
DELETE FROM message_links WHERE message_id = $1;

-- name: DeleteMessageLinksExcept :exec
DELETE FROM message_links
WHERE message_id = sqlc.arg(message_id) AND NOT (url = ANY(sqlc.arg(urls)::text[]));

-- name: ListLinkPreviewsForMessages :many
SELECT ml.message_id, ml.position, p.*
FROM message_links ml
JOIN link_previews p ON p.url = ml.url
WHERE ml.message_id = ANY($1::uuid[]) AND p.state = 'ok' AND NOT ml.dismissed
ORDER BY ml.message_id, ml.position;
