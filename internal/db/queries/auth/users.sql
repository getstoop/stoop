-- Users and the instance role. Owned by the auth module.
-- Only internal/auth may use these queries.

-- name: CreateUser :one
INSERT INTO users (id, username, display_name, password_hash, role, username_pending)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: UsernameTaken :one
SELECT EXISTS(SELECT 1 FROM users WHERE username = $1);

-- SetUsername renames the handle (self-service). Usernames are freely
-- changeable — the id is the durable identity everywhere — unless an
-- admin froze the handle; it also settles the "derived from a login
-- provider" flag.
-- name: SetUsername :one
UPDATE users SET username = $2, username_pending = false
WHERE id = $1 AND NOT username_frozen
RETURNING *;

-- AdminSetUsername is the admin rename; it bypasses the freeze, so an
-- admin can fix an offensive handle and then lock it.
-- name: AdminSetUsername :one
UPDATE users SET username = $2, username_pending = false
WHERE id = $1
RETURNING *;

-- name: SetUsernameFrozen :one
UPDATE users SET username_frozen = $2 WHERE id = $1 RETURNING *;

-- name: CountUsers :one
SELECT count(*) FROM users;

-- name: LockUserBootstrap :exec
SELECT pg_advisory_xact_lock(7001);

-- name: GetUserByUsername :one
SELECT * FROM users WHERE username = $1;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUsersByIDs :many
SELECT id, username, display_name, role, avatar_file_id FROM users WHERE id = ANY($1::uuid[]);

-- GetUserProfile is one person's public face, for their profile card. Its
-- own query rather than GetUserByID because that one is SELECT * and would
-- put the password hash one line away from a response.
-- name: GetUserProfile :one
SELECT id, username, display_name, avatar_file_id, pronouns, bio
FROM users WHERE id = $1;

-- UpdateUserProfile writes the fields a person (or an admin acting on
-- their account) may change; a null argument leaves that column alone.
-- name: UpdateUserProfile :one
UPDATE users SET
    display_name = coalesce(sqlc.narg('display_name')::text, display_name),
    pronouns     = coalesce(sqlc.narg('pronouns')::text,     pronouns),
    bio          = coalesce(sqlc.narg('bio')::text,          bio)
WHERE id = $1
RETURNING *;

-- name: UpdateUserPasswordHash :exec
UPDATE users SET password_hash = $2 WHERE id = $1;

-- name: ListUsers :many
SELECT * FROM users ORDER BY created_at;

-- name: CountAdmins :one
SELECT count(*) FROM users WHERE role = 'admin' AND deactivated_at IS NULL;

-- name: SetUserRole :one
UPDATE users SET role = $2 WHERE id = $1 RETURNING *;

-- name: SetUserDeactivated :one
UPDATE users
SET deactivated_at = CASE WHEN sqlc.arg(deactivated)::boolean THEN now() ELSE NULL END
WHERE id = $1
RETURNING *;

-- name: SetUserRoleByUsername :one
UPDATE users SET role = $2 WHERE username = $1 RETURNING *;

-- The avatar pointer is replaced in a transaction: lock the row and read
-- the current file id, then update, so the caller can delete the old blob
-- without racing another upload.
-- name: GetUserAvatarForUpdate :one
SELECT avatar_file_id FROM users WHERE id = $1 FOR UPDATE;

-- name: SetUserAvatar :exec
UPDATE users SET avatar_file_id = sqlc.narg('avatar_file_id') WHERE id = $1;

-- ReferencedAvatarFileIDs: which of these files are someone's current
-- avatar. For the files module's sweep, through its port.
-- name: ReferencedAvatarFileIDs :many
SELECT avatar_file_id::uuid AS id FROM users WHERE avatar_file_id = ANY(sqlc.arg(ids)::uuid[]);
