-- Message search. Owned by the chat module.
-- Only internal/chat may use these queries.

-- SearchMessages: one space's channels, newest first, with the same reply
-- columns as ListMessagesBefore so rows hydrate through one path. `words`
-- is websearch syntax; `prefix` is a quoted lexeme with :* or "" (see
-- internal/chat/search_query.go). Dates bound created_at; the cursor
-- bounds id.
-- name: SearchMessages :many
SELECT sqlc.embed(m), p.author_id AS reply_author_id, p.content AS reply_content,
    COALESCE((SELECT a.file_id::text FROM message_attachments a WHERE a.message_id = p.id ORDER BY a.position LIMIT 1), '')::text AS reply_first_file_id
FROM messages m
LEFT JOIN messages p ON p.id = m.reply_to_message_id
WHERE m.channel_id IN (SELECT c.id FROM channels c WHERE c.space_id = sqlc.arg(space_id)::uuid)
  AND m.search @@ (CASE WHEN sqlc.arg(prefix)::text = ''
      THEN websearch_to_tsquery('simple', sqlc.arg(words)::text)
      ELSE websearch_to_tsquery('simple', sqlc.arg(words)::text) && to_tsquery('simple', sqlc.arg(prefix)::text)
      END)
  AND (sqlc.narg(channel_id)::uuid IS NULL OR m.channel_id = sqlc.narg(channel_id)::uuid)
  AND (sqlc.narg(author_id)::uuid IS NULL OR m.author_id = sqlc.narg(author_id)::uuid)
  AND (sqlc.narg(after_at)::timestamptz IS NULL OR m.created_at >= sqlc.narg(after_at)::timestamptz)
  AND (sqlc.narg(before_at)::timestamptz IS NULL OR m.created_at < sqlc.narg(before_at)::timestamptz)
  AND (sqlc.narg(before_id)::uuid IS NULL OR m.id < sqlc.narg(before_id)::uuid)
ORDER BY m.id DESC
LIMIT sqlc.arg(lim);

-- GetChannelInSpaceByName resolves an in:#name filter. Names are not
-- unique within a space; the first by position wins, as in the sidebar.
-- name: GetChannelInSpaceByName :one
SELECT * FROM channels
WHERE space_id = sqlc.arg(space_id)::uuid AND name = sqlc.arg(name)
ORDER BY position, created_at
LIMIT 1;
