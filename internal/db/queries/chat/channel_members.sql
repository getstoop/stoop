-- The people in a private channel. Owned by the chat module.
-- Only internal/chat may use these queries.

-- name: IsPrivateChannelMember :one
SELECT EXISTS (
    SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2
) AS is_member;

-- name: ListPrivateChannelMemberIDs :many
SELECT user_id FROM channel_members WHERE channel_id = $1 ORDER BY added_at, user_id;

-- AddPrivateChannelMember reports 0 rows for someone already in.
-- name: AddPrivateChannelMember :execrows
INSERT INTO channel_members (channel_id, space_id, user_id, added_by)
VALUES (sqlc.arg(channel_id), sqlc.arg(space_id)::uuid, sqlc.arg(user_id), sqlc.narg(added_by))
ON CONFLICT DO NOTHING;

-- name: RemovePrivateChannelMember :execrows
DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2;
