-- Activity items. Owned by the chat module.
-- Only internal/chat may use these queries.

-- CreateActivityItems writes one item of a kind for each recipient of
-- a message, in one statement (see chat.notify). Nothing is written for
-- a message deleted since it was sent: activity is recorded after the
-- send commits, and a tombstone's items go with it.
-- name: CreateActivityItems :many
INSERT INTO activity_items (id, user_id, kind, space_id, channel_id, message_id, actor_id)
SELECT unnest(sqlc.arg('ids')::uuid[]), unnest(sqlc.arg('user_ids')::uuid[]), sqlc.arg('kind')::text,
    sqlc.narg('space_id')::uuid, sqlc.arg('channel_id')::uuid, sqlc.arg('message_id')::uuid, sqlc.arg('actor_id')::uuid
WHERE EXISTS (SELECT 1 FROM messages m WHERE m.id = sqlc.arg('message_id')::uuid AND m.deleted_at IS NULL)
RETURNING *;

-- ListActivity returns newest first with the message text for a
-- preview (NULL if the message has since been deleted), and the
-- recipient's effective mute for where each item happened. An item from
-- a channel the recipient can no longer read is left out: its preview
-- shows the message as it now reads.
-- name: ListActivity :many
SELECT sqlc.embed(a), m.content AS message_content, m.thread_root_id AS message_thread_root_id,
    COALESCE((SELECT f.file_id::text FROM message_attachments f WHERE f.message_id = m.id ORDER BY f.position LIMIT 1), '')::text AS message_first_file_id,
    (EXISTS (SELECT 1 FROM channel_mutes cm WHERE cm.user_id = a.user_id AND cm.channel_id = a.channel_id)
        OR EXISTS (SELECT 1 FROM space_mutes sm WHERE sm.user_id = a.user_id AND sm.space_id = a.space_id)
        OR EXISTS (SELECT 1 FROM thread_mutes tm WHERE tm.user_id = a.user_id AND tm.root_message_id = m.thread_root_id))::bool AS muted
FROM activity_items a
LEFT JOIN messages m ON m.id = a.message_id
WHERE a.user_id = $1
  AND EXISTS (SELECT 1 FROM channel_readers cr WHERE cr.channel_id = a.channel_id AND cr.user_id = a.user_id)
  AND (sqlc.narg('before_id')::uuid IS NULL OR a.id < sqlc.narg('before_id')::uuid)
ORDER BY a.id DESC
LIMIT $2;

-- CountUnreadActivity counts what ListActivity would list.
-- name: CountUnreadActivity :one
SELECT count(*) FROM activity_items a
WHERE a.user_id = $1 AND a.read_at IS NULL
  AND EXISTS (SELECT 1 FROM channel_readers cr WHERE cr.channel_id = a.channel_id AND cr.user_id = a.user_id);

-- name: MarkActivityRead :exec
UPDATE activity_items SET read_at = now()
WHERE user_id = $1 AND read_at IS NULL AND id = ANY(sqlc.arg('ids')::uuid[]);

-- name: MarkAllActivityRead :exec
UPDATE activity_items SET read_at = now()
WHERE user_id = $1 AND read_at IS NULL;

-- UpsertUnreadActivityItems is CreateActivityItems for a kind that
-- coalesces per channel, as a DM's alerts do (see chat.recordDM), or per
-- thread when thread_root_id is set: a recipient's newest unread item of
-- the kind there is pointed at the new message and stamped now; a
-- recipient without one gets a new item. Nothing is refreshed or written
-- for a message deleted since it was sent, as CreateActivityItems writes
-- nothing.
-- name: UpsertUnreadActivityItems :many
WITH live AS (
    SELECT 1 FROM messages m WHERE m.id = sqlc.arg('message_id')::uuid AND m.deleted_at IS NULL
), recipient AS (
    SELECT unnest(sqlc.arg('ids')::uuid[]) AS id, unnest(sqlc.arg('user_ids')::uuid[]) AS user_id
), unread AS (
    SELECT DISTINCT ON (a.user_id) a.id, a.user_id
    FROM activity_items a
    WHERE a.user_id = ANY(sqlc.arg('user_ids')::uuid[])
      AND a.channel_id = sqlc.arg('channel_id')::uuid
      AND a.kind = sqlc.arg('kind')::text
      AND a.read_at IS NULL
      AND (sqlc.narg('thread_root_id')::uuid IS NULL
           OR EXISTS (SELECT 1 FROM messages m
                      WHERE m.id = a.message_id AND m.thread_root_id = sqlc.narg('thread_root_id')::uuid))
    ORDER BY a.user_id, a.id DESC
), refreshed AS (
    UPDATE activity_items a
    SET message_id = sqlc.arg('message_id')::uuid, actor_id = sqlc.arg('actor_id')::uuid, created_at = now()
    FROM unread u
    WHERE a.id = u.id AND EXISTS (SELECT 1 FROM live)
    RETURNING a.id, a.user_id, a.kind, a.space_id, a.channel_id, a.message_id, a.actor_id, a.created_at, a.read_at
), created AS (
    INSERT INTO activity_items (id, user_id, kind, space_id, channel_id, message_id, actor_id)
    SELECT r.id, r.user_id, sqlc.arg('kind')::text, sqlc.narg('space_id')::uuid,
        sqlc.arg('channel_id')::uuid, sqlc.arg('message_id')::uuid, sqlc.arg('actor_id')::uuid
    FROM recipient r
    WHERE EXISTS (SELECT 1 FROM live) AND NOT EXISTS (SELECT 1 FROM unread u WHERE u.user_id = r.user_id)
    RETURNING id, user_id, kind, space_id, channel_id, message_id, actor_id, created_at, read_at
)
SELECT id, user_id, kind, space_id, channel_id, message_id, actor_id, created_at, read_at FROM refreshed
UNION ALL
SELECT id, user_id, kind, space_id, channel_id, message_id, actor_id, created_at, read_at FROM created;

-- DeleteReadActivityBefore drops read items older than the
-- retention window; unread ones stay however old (see chat.SweepActivity).
-- name: DeleteReadActivityBefore :execrows
DELETE FROM activity_items WHERE read_at IS NOT NULL AND read_at < sqlc.arg(before)::timestamptz;

-- DeleteActivityForBlocked drops the alerts a block is meant to silence:
-- anything the blocked person caused, and anything in a direct message
-- they are part of. Without it a block leaves a badge nobody can clear —
-- the conversation is hidden from the blocker's list, so there is nothing
-- left to open and mark read.
-- name: DeleteActivityForBlocked :execrows
DELETE FROM activity_items a
WHERE a.user_id = sqlc.arg(user_id)
  AND (a.actor_id = sqlc.arg(blocked_id)
    OR EXISTS (
      SELECT 1 FROM dm_members d
      WHERE d.channel_id = a.channel_id AND d.user_id = sqlc.arg(blocked_id)
    ));

-- DeleteActivityForChannel drops a person's alerts from a channel they
-- can no longer read: each keeps a preview of the message.
-- name: DeleteActivityForChannel :exec
DELETE FROM activity_items WHERE user_id = sqlc.arg(user_id) AND channel_id = sqlc.arg(channel_id);

-- DeleteActivityForPrivateChannels drops a person's alerts from a space's
-- private channels when they leave the space. An alert shows its message
-- as it now reads, so one left behind would go on showing edits.
-- name: DeleteActivityForPrivateChannels :exec
DELETE FROM activity_items a USING channels c
WHERE a.user_id = sqlc.arg(user_id) AND c.id = a.channel_id
  AND c.space_id = sqlc.arg(space_id)::uuid AND c.private;
