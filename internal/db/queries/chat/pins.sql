-- Pinned messages. Owned by the chat module.
-- Only internal/chat may use these queries.

-- PinMessage is the cap check and the insert in one statement, so a pin
-- cannot read a stale count and then write. No row comes back when the
-- message is already pinned or the channel is full; the caller tells
-- those apart with GetPin.
-- name: PinMessage :one
INSERT INTO channel_pins (message_id, channel_id, pinned_by)
SELECT sqlc.arg(message_id)::uuid, sqlc.arg(channel_id)::uuid, sqlc.arg(pinned_by)::uuid
WHERE (SELECT count(*) FROM channel_pins WHERE channel_id = sqlc.arg(channel_id)::uuid) < sqlc.arg(cap)::int
ON CONFLICT (message_id) DO NOTHING
RETURNING *;

-- name: GetPin :one
SELECT * FROM channel_pins WHERE message_id = $1;

-- name: UnpinMessage :execrows
DELETE FROM channel_pins WHERE message_id = $1;

-- ListChannelPins reads message_with_reply like ListMessagesBefore, so
-- the rows hydrate through one path (internal/chat/messages.go).
-- name: ListChannelPins :many
SELECT sqlc.embed(m), pin.pinned_by, pin.pinned_at
FROM channel_pins pin
JOIN message_with_reply m ON m.id = pin.message_id
WHERE pin.channel_id = sqlc.arg(channel_id)::uuid
ORDER BY pin.pinned_at DESC, pin.message_id DESC
LIMIT sqlc.arg(lim);

-- PinnedMessageIDs stamps the pinned flag on a page of messages: one
-- primary-key lookup over a table holding at most the cap per channel.
-- name: PinnedMessageIDs :many
SELECT message_id FROM channel_pins WHERE message_id = ANY(sqlc.arg(ids)::uuid[]);
