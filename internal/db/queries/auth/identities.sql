-- Linked sign-in identities (login providers). Owned by the auth module.
-- Only internal/auth may use these queries.

-- name: GetUserByIdentity :one
SELECT u.* FROM users u
JOIN user_identities i ON i.user_id = u.id
WHERE i.provider = $1 AND i.subject = $2;

-- name: CreateIdentity :one
INSERT INTO user_identities (provider, subject, user_id, email)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListUserIdentities :many
SELECT * FROM user_identities WHERE user_id = $1 ORDER BY created_at;

-- name: DeleteUserIdentity :execrows
DELETE FROM user_identities WHERE user_id = $1 AND provider = $2;

-- name: CountUserIdentities :one
SELECT count(*) FROM user_identities WHERE user_id = $1;
