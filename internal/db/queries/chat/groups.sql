-- Groups: a set of a space's members that one mention reaches. Owned by the
-- chat module. Only internal/chat may use these queries.

-- name: ListGroups :many
SELECT * FROM groups WHERE space_id = $1 ORDER BY handle;

-- name: ListGroupMembersInSpace :many
SELECT group_id, user_id FROM group_members WHERE space_id = $1;

-- name: GetGroup :one
SELECT * FROM groups WHERE id = $1;

-- name: CreateGroup :one
INSERT INTO groups (id, space_id, handle, name)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpdateGroup :one
UPDATE groups SET handle = $2, name = $3 WHERE id = $1
RETURNING *;

-- name: DeleteGroup :execrows
DELETE FROM groups WHERE id = $1;

-- RemoveGroupMembersExcept drops the group's members not in user_ids,
-- and touches no other row: saving a group leaves an unchanged member's
-- row alone. A NULL list counts as empty and keeps nobody, as an empty
-- one does (user_id <> ALL (NULL) would match no row).
-- name: RemoveGroupMembersExcept :exec
DELETE FROM group_members
WHERE group_id = @group_id::uuid
  AND user_id <> ALL (COALESCE(@user_ids::uuid[], '{}'::uuid[]));

-- AddGroupMembers puts these people in the group. Someone already in it
-- is left as they are: no write, and no foreign-key check on their
-- membership, which a removal from the space may be holding.
-- name: AddGroupMembers :exec
INSERT INTO group_members (group_id, space_id, user_id)
SELECT @group_id::uuid, @space_id::uuid, unnest(@user_ids::uuid[])
ON CONFLICT DO NOTHING;

-- ListGroupMemberIDsByGroupIDs is who a message's group tokens reach.
-- name: ListGroupMemberIDsByGroupIDs :many
SELECT DISTINCT user_id FROM group_members WHERE group_id = ANY (@group_ids::uuid[]);

-- ListSpaceGroupsByIDs is which of a message's group tokens name a group
-- of its channel's space.
-- name: ListSpaceGroupsByIDs :many
SELECT id, handle FROM groups
WHERE space_id = @space_id AND id = ANY (@ids::uuid[]);

-- ListGroupHandlesByIDs is the current handles behind tokens, for previews.
-- name: ListGroupHandlesByIDs :many
SELECT id, handle FROM groups WHERE id = ANY (@ids::uuid[]);
