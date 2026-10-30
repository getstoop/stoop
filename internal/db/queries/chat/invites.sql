-- Invites: redeemable codes granting space membership. Owned by the chat module.
-- Only internal/chat may use these queries.

-- name: CreateInvite :one
INSERT INTO invites (id, space_id, code, created_by, expires_at, max_uses, role, label)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetInvite :one
SELECT * FROM invites WHERE id = $1;

-- name: GetInviteByCode :one
SELECT * FROM invites WHERE code = $1;

-- name: ListInvitesBySpace :many
SELECT * FROM invites WHERE space_id = $1 ORDER BY created_at DESC, id DESC;

-- ListInvitesByCreator is what a member without invites.manage sees: only
-- what they made.
-- name: ListInvitesByCreator :many
SELECT * FROM invites WHERE space_id = $1 AND created_by = $2 ORDER BY created_at DESC, id DESC;

-- name: RecordInviteUse :exec
INSERT INTO invite_uses (id, invite_id, user_id) VALUES ($1, $2, $3);

-- name: ListInviteUses :many
SELECT user_id, used_at FROM invite_uses WHERE invite_id = $1 ORDER BY used_at DESC, id DESC;

-- name: RevokeInvite :one
UPDATE invites
SET revoked_at = COALESCE(revoked_at, now())
WHERE id = $1
RETURNING *;

-- name: ConsumeInvite :one
UPDATE invites
SET use_count = use_count + 1
WHERE code = $1
  AND revoked_at IS NULL
  AND (expires_at IS NULL OR expires_at > now())
  AND (max_uses IS NULL OR use_count < max_uses)
RETURNING *;

-- LookupInviteByCode backs the public invite preview: the code with its
-- space's public face and size, so a stranger can see what they are being
-- asked to join. The space's welcome text is deliberately not selected.
-- name: LookupInviteByCode :one
SELECT sqlc.embed(i),
    s.name AS space_name,
    s.description AS space_description,
    s.icon_file_id AS space_icon_file_id,
    (SELECT count(*) FROM space_members m WHERE m.space_id = s.id) AS member_count
FROM invites i
JOIN spaces s ON s.id = i.space_id
WHERE i.code = $1;
