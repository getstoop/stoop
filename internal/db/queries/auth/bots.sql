-- Bots and the credentials they hold. Owned by the auth module.
-- Only internal/auth may use these queries.

-- name: CreateBot :one
INSERT INTO users (id, username, display_name, password_hash, role, kind)
VALUES ($1, $2, $3, NULL, 'member', 'bot')
RETURNING *;

-- name: ListBots :many
SELECT * FROM users WHERE kind = 'bot' ORDER BY created_at, id;

-- CreateBotCredential mints a bot token or hook token; the holder must be
-- a bot, or no row is inserted.
-- name: CreateBotCredential :one
INSERT INTO credentials (id, holder_id, kind, token_hash, name, grants, bounded, created_by, hint)
SELECT sqlc.arg(id)::uuid, u.id, sqlc.arg(kind)::text, sqlc.arg(token_hash)::bytea,
       sqlc.arg(name)::text, sqlc.arg(grants)::text[], sqlc.arg(bounded)::boolean,
       sqlc.narg(created_by)::uuid, sqlc.arg(hint)::text
FROM users u
WHERE u.id = sqlc.arg(holder_id)::uuid AND u.kind = 'bot' AND u.deactivated_at IS NULL
RETURNING *;

-- name: AddCredentialChannelBound :exec
INSERT INTO credential_bounds (credential_id, channel_id)
VALUES (sqlc.arg(credential_id)::uuid, sqlc.arg(channel_id)::uuid);

-- name: SetBotCredentialGrants :execrows
UPDATE credentials SET grants = $2
WHERE id = $1 AND kind IN ('bot_token', 'incoming_hook');

-- ListBotCredentials is every token and hook credential, for the given
-- holders or, with an empty list, for every bot.
-- name: ListBotCredentials :many
SELECT c.id, c.holder_id, c.kind, c.name, c.grants, c.bounded, c.created_at, c.last_used_at, c.hint,
       coalesce(array_agg(b.space_id) FILTER (WHERE b.space_id IS NOT NULL), '{}')::uuid[] AS bound_spaces,
       coalesce(array_agg(b.channel_id) FILTER (WHERE b.channel_id IS NOT NULL), '{}')::uuid[] AS bound_channels
FROM credentials c
LEFT JOIN credential_bounds b ON b.credential_id = c.id
WHERE c.kind IN ('bot_token', 'incoming_hook')
  AND (cardinality(sqlc.arg(holder_ids)::uuid[]) = 0 OR c.holder_id = ANY(sqlc.arg(holder_ids)::uuid[]))
GROUP BY c.id
ORDER BY c.created_at, c.id;

-- name: GetBotCredentials :many
SELECT c.id, c.holder_id, c.kind, c.name, c.grants, c.bounded, c.created_at, c.last_used_at, c.hint,
       coalesce(array_agg(b.space_id) FILTER (WHERE b.space_id IS NOT NULL), '{}')::uuid[] AS bound_spaces,
       coalesce(array_agg(b.channel_id) FILTER (WHERE b.channel_id IS NOT NULL), '{}')::uuid[] AS bound_channels
FROM credentials c
LEFT JOIN credential_bounds b ON b.credential_id = c.id
WHERE c.kind IN ('bot_token', 'incoming_hook') AND c.id = ANY(sqlc.arg(ids)::uuid[])
GROUP BY c.id;

-- name: DeleteBotCredential :many
DELETE FROM credentials
WHERE id = $1 AND kind IN ('bot_token', 'incoming_hook')
RETURNING id, holder_id;

-- name: CountBotCredentials :one
SELECT count(*) FROM credentials WHERE holder_id = $1 AND kind IN ('bot_token', 'incoming_hook');
