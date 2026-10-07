-- Emoji reactions. Owned by the chat module.
-- Only internal/chat may use these queries.

-- AddReaction adds nothing to a root kept as a placeholder. The share lock
-- orders it against MakePlaceholder: a reaction either lands first and is
-- cleared with the rest, or waits and finds the message deleted.
-- name: AddReaction :execrows
INSERT INTO message_reactions (message_id, user_id, emoji)
SELECT sqlc.arg(message_id)::uuid, sqlc.arg(user_id)::uuid, sqlc.arg(emoji)::text
WHERE EXISTS (SELECT 1 FROM messages WHERE id = sqlc.arg(message_id)::uuid AND deleted_at IS NULL FOR SHARE)
ON CONFLICT DO NOTHING;

-- name: RemoveReaction :execrows
DELETE FROM message_reactions
WHERE message_id = $1 AND user_id = $2 AND emoji = $3;

-- ListReactionsForMessages feeds one grouped pass per page. Ordered by
-- emoji, then by when each reaction was added, so chip order is stable
-- and the reactor lists are in arrival order.
-- name: ListReactionsForMessages :many
SELECT message_id, emoji, user_id
FROM message_reactions
WHERE message_id = ANY($1::uuid[])
ORDER BY message_id, emoji, created_at, user_id;
