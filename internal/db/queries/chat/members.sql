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

-- IsChannelMember: a member of the channel's space, or a participant in
-- the direct message.
-- name: IsChannelMember :one
SELECT EXISTS (
    SELECT 1
    FROM channels c
    LEFT JOIN space_members m ON m.space_id = c.space_id AND m.user_id = $2
    LEFT JOIN dm_members d ON d.channel_id = c.id AND d.user_id = $2
    WHERE c.id = $1 AND (m.user_id IS NOT NULL OR d.user_id IS NOT NULL)
) AS is_member;

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
