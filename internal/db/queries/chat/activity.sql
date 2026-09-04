-- Activity items. Owned by the chat module.
-- Only internal/chat may use these queries.

-- name: CreateActivityItem :one
INSERT INTO activity_items (id, user_id, kind, space_id, channel_id, message_id, actor_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- ListActivity returns newest first with the message text for a
-- preview (NULL if the message has since been deleted), and the
-- recipient's effective mute for where each item happened.
-- name: ListActivity :many
SELECT sqlc.embed(a), m.content AS message_content,
    COALESCE((SELECT f.file_id::text FROM message_attachments f WHERE f.message_id = m.id ORDER BY f.position LIMIT 1), '')::text AS message_first_file_id,
    (EXISTS (SELECT 1 FROM channel_mutes cm WHERE cm.user_id = a.user_id AND cm.channel_id = a.channel_id)
        OR EXISTS (SELECT 1 FROM space_mutes sm WHERE sm.user_id = a.user_id AND sm.space_id = a.space_id))::bool AS muted
FROM activity_items a
LEFT JOIN messages m ON m.id = a.message_id
WHERE a.user_id = $1
  AND (sqlc.narg('before_id')::uuid IS NULL OR a.id < sqlc.narg('before_id')::uuid)
ORDER BY a.id DESC
LIMIT $2;

-- name: CountUnreadActivity :one
SELECT count(*) FROM activity_items WHERE user_id = $1 AND read_at IS NULL;

-- name: MarkActivityRead :exec
UPDATE activity_items SET read_at = now()
WHERE user_id = $1 AND read_at IS NULL AND id = ANY(sqlc.arg('ids')::uuid[]);

-- name: MarkAllActivityRead :exec
UPDATE activity_items SET read_at = now()
WHERE user_id = $1 AND read_at IS NULL;

-- The unread activity item of one kind for a channel, if any: a DM's
-- alerts coalesce into it instead of piling up (see chat.recordDM).
-- name: GetUnreadActivityForChannel :one
SELECT * FROM activity_items
WHERE user_id = $1 AND channel_id = $2 AND kind = $3 AND read_at IS NULL
ORDER BY id DESC
LIMIT 1;

-- RefreshActivityItem points an existing item at a newer message
-- and stamps it now, so the entry reads as the latest activity.
-- name: RefreshActivityItem :one
UPDATE activity_items SET message_id = $2, actor_id = $3, created_at = now()
WHERE id = $1
RETURNING *;

-- DeleteReadActivityBefore drops read items older than the
-- retention window; unread ones stay however old (see chat.SweepActivity).
-- name: DeleteReadActivityBefore :execrows
DELETE FROM activity_items WHERE read_at IS NOT NULL AND read_at < sqlc.arg(before)::timestamptz;
