-- Space membership and roles. Owned by the chat module.
-- Only internal/chat may use these queries.

-- name: CreateSpaceMember :exec
INSERT INTO space_members (space_id, user_id, role)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: IsSpaceMember :one
SELECT EXISTS (
    SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2
) AS is_member;

-- IsChannelMember: whether the person may read the channel.
-- name: IsChannelMember :one
SELECT EXISTS (
    SELECT 1 FROM channel_readers cr
    WHERE cr.channel_id = sqlc.arg(channel_id)::uuid AND cr.user_id = sqlc.arg(user_id)::uuid
) AS is_member;

-- ChannelMembersAmong is which of these people can still read the
-- channel.
-- name: ChannelMembersAmong :many
SELECT u.id::uuid FROM unnest(sqlc.arg(user_ids)::uuid[]) AS u(id)
WHERE EXISTS (SELECT 1 FROM channel_readers cr
              WHERE cr.channel_id = sqlc.arg(channel_id)::uuid AND cr.user_id = u.id);

-- name: ListSpaceIDsByUser :many
SELECT space_id FROM space_members WHERE user_id = $1;

-- name: GetSpaceMemberRole :one
SELECT role FROM space_members WHERE space_id = $1 AND user_id = $2;

-- name: ListSpaceMembers :many
SELECT * FROM space_members
WHERE space_id = $1
ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, joined_at;

-- name: SetSpaceMemberRole :execrows
UPDATE space_members SET role = $3 WHERE space_id = $1 AND user_id = $2;

-- name: DeleteSpaceMember :execrows
DELETE FROM space_members WHERE space_id = $1 AND user_id = $2;

-- name: GetSpaceMember :one
SELECT * FROM space_members WHERE space_id = $1 AND user_id = $2;

-- LongestServingAdmin is who takes a space when its owner's account is
-- deleted: the admin who joined first.
-- name: LongestServingAdmin :one
SELECT user_id FROM space_members
WHERE space_id = $1 AND role = 'admin'
ORDER BY joined_at LIMIT 1;

-- name: ListOwnedSpaceIDs :many
SELECT id FROM spaces WHERE owner_id = $1;
