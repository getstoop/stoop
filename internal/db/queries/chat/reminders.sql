-- Reminders. Owned by the chat module.
-- Only internal/chat may use these queries.
--
-- A reminder waits in reminders until its time, then becomes a messages
-- row of kind 9 (internal/chat/reminders.go).

-- LockReminderOwner serialises one person's CreateReminder calls, so two
-- at once cannot both count 49 waiting and store a 51st.
-- name: LockReminderOwner :exec
SELECT pg_advisory_xact_lock(4207031, hashtext(sqlc.arg(user_id)::text));

-- name: CountRemindersByUser :one
SELECT count(*) FROM reminders WHERE user_id = sqlc.arg(user_id)::uuid;

-- name: CreateReminder :one
INSERT INTO reminders (id, channel_id, user_id, content, remind_at)
VALUES (sqlc.arg(id), sqlc.arg(channel_id), sqlc.arg(user_id), sqlc.arg(content), sqlc.arg(remind_at))
RETURNING *;

-- DeleteOwnReminder takes back a waiting reminder of the caller's own
-- and says which channel it was for. No row is someone else's, one
-- already delivered, or none at all.
-- name: DeleteOwnReminder :one
DELETE FROM reminders WHERE id = sqlc.arg(id)::uuid AND user_id = sqlc.arg(user_id)::uuid
RETURNING channel_id;

-- ListDueReminders is what a delivery run works through, oldest first.
-- It locks nothing: delivery takes the channel row before the reminder
-- (internal/chat/seq.go), and claims each with ClaimReminder.
-- name: ListDueReminders :many
SELECT id, channel_id, user_id FROM reminders
WHERE remind_at <= sqlc.arg(now)
ORDER BY remind_at, id
LIMIT sqlc.arg('limit');

-- ClaimReminder takes a due reminder out of the table for whoever holds
-- its channel row. No row means an Undo or another dispatcher got there
-- first.
-- name: ClaimReminder :one
DELETE FROM reminders WHERE id = sqlc.arg(id)::uuid AND remind_at <= sqlc.arg(now)
RETURNING *;
