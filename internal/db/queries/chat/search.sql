-- Message search. Owned by the chat module.
-- Only internal/chat may use these queries.

-- SearchMessages: one space's channels, newest first, read from
-- message_with_reply like ListMessagesBefore, joined back to messages
-- for the search vector the view leaves out. `words` is websearch
-- syntax; `prefix` is a quoted lexeme with :* or "" (see
-- internal/chat/search_query.go). Dates bound created_at; the cursor
-- bounds id. Hidden voice channels (kind 2) are left out.
-- name: SearchMessages :many
SELECT m.* FROM message_with_reply m
JOIN messages indexed ON indexed.id = m.id
WHERE m.channel_id IN (SELECT c.id FROM channels c WHERE c.space_id = sqlc.arg(space_id)::uuid
        AND (sqlc.arg(with_voice)::bool OR c.kind <> 2))
  AND indexed.search @@ (CASE
      WHEN sqlc.arg(prefix)::text = '' THEN websearch_to_tsquery('simple', sqlc.arg(words)::text)
      WHEN sqlc.arg(words)::text = '' THEN to_tsquery('simple', sqlc.arg(prefix)::text)
      ELSE websearch_to_tsquery('simple', sqlc.arg(words)::text) && to_tsquery('simple', sqlc.arg(prefix)::text)
      END)
  AND (sqlc.narg(channel_id)::uuid IS NULL OR m.channel_id = sqlc.narg(channel_id)::uuid)
  AND (sqlc.narg(author_id)::uuid IS NULL OR m.author_id = sqlc.narg(author_id)::uuid)
  AND (sqlc.narg(after_at)::timestamptz IS NULL OR m.created_at >= sqlc.narg(after_at)::timestamptz)
  AND (sqlc.narg(before_at)::timestamptz IS NULL OR m.created_at < sqlc.narg(before_at)::timestamptz)
  AND (sqlc.narg(before_id)::uuid IS NULL OR m.id < sqlc.narg(before_id)::uuid)
ORDER BY m.id DESC
LIMIT sqlc.arg(lim);

-- GetChannelInSpaceByName resolves an in:#name filter. Names from before
-- the naming rule may repeat or carry capitals: an exact match wins, then
-- the first by position, as in the sidebar.
-- name: GetChannelInSpaceByName :one
SELECT * FROM channels
WHERE space_id = sqlc.arg(space_id)::uuid AND lower(name) = lower(sqlc.arg(name))
ORDER BY (name = sqlc.arg(name)) DESC, position, created_at
LIMIT 1;
