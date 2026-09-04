-- Message attachments: which files a message carries. Owned by the chat
-- module; file metadata (name, type, size) comes from the files module
-- through a port. Only internal/chat may use these queries.

-- name: InsertMessageAttachment :exec
INSERT INTO message_attachments (message_id, file_id, position)
VALUES ($1, $2, $3);

-- name: ListAttachmentsForMessages :many
SELECT message_id, file_id, position FROM message_attachments
WHERE message_id = ANY($1::uuid[])
ORDER BY message_id, position;

-- name: ListAttachmentFileIDsForMessage :many
SELECT file_id FROM message_attachments WHERE message_id = $1 ORDER BY position;

-- IsAttachmentReadable: the file is attached to a message in a channel
-- the user can read (space member or DM participant). Files' download
-- rule for attachments that have no space.
-- name: IsAttachmentReadable :one
SELECT EXISTS (
    SELECT 1
    FROM message_attachments a
    JOIN messages m ON m.id = a.message_id
    JOIN channels c ON c.id = m.channel_id
    LEFT JOIN space_members sm ON sm.space_id = c.space_id AND sm.user_id = $2
    LEFT JOIN dm_members d ON d.channel_id = c.id AND d.user_id = $2
    WHERE a.file_id = $1 AND (sm.user_id IS NOT NULL OR d.user_id IS NOT NULL)
) AS readable;

-- ReferencedFileIDs: which of these files chat still points at — an
-- attachment on a message, a link preview's image, a space's icon. The
-- files module's sweep asks through its port; anything else is an orphan.
-- name: ReferencedFileIDs :many
SELECT a.file_id::uuid AS id FROM message_attachments a WHERE a.file_id = ANY(sqlc.arg(ids)::uuid[])
UNION
SELECT p.image_file_id::uuid FROM link_previews p WHERE p.image_file_id = ANY(sqlc.arg(ids)::uuid[])
UNION
SELECT s.icon_file_id::uuid FROM spaces s WHERE s.icon_file_id = ANY(sqlc.arg(ids)::uuid[]);
