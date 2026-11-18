-- Push subscriptions, one per session. Owned by the push module.
-- Only internal/push may use these queries.

-- PutPushSubscription stores the session's subscription, replacing any it
-- had: a new endpoint starts with a clean record.
-- name: PutPushSubscription :exec
INSERT INTO push_subscriptions (id, credential_id, user_id, endpoint, p256dh, auth, local_server_id, kinds)
VALUES (sqlc.arg(id)::uuid, sqlc.arg(credential_id)::uuid, sqlc.arg(user_id)::uuid, sqlc.arg(endpoint)::text,
        sqlc.arg(p256dh)::bytea, sqlc.arg(auth)::bytea, sqlc.arg(local_server_id)::text, sqlc.arg(kinds)::integer[])
ON CONFLICT (credential_id) DO UPDATE
SET endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth,
    local_server_id = excluded.local_server_id, kinds = excluded.kinds,
    created_at = now(), last_success_at = NULL, failures = 0, last_failure_at = NULL, last_failure = '';

-- name: SetPushSubscriptionKinds :execrows
UPDATE push_subscriptions SET kinds = sqlc.arg(kinds)::integer[]
WHERE credential_id = sqlc.arg(credential_id)::uuid;

-- name: DeletePushSubscription :exec
DELETE FROM push_subscriptions WHERE credential_id = $1;

-- ListPushUserIDs is everyone with a subscription: the people whose
-- topics the push listener hears.
-- name: ListPushUserIDs :many
SELECT DISTINCT user_id FROM push_subscriptions;

-- ListPushSubscriptionsByUser is one person's subscriptions, one per
-- signed-in device.
-- name: ListPushSubscriptionsByUser :many
SELECT id, credential_id, kinds FROM push_subscriptions WHERE user_id = $1;

-- name: GetPushSubscription :one
SELECT id, credential_id, user_id, endpoint, p256dh, auth, local_server_id
FROM push_subscriptions WHERE id = $1;

-- The delivery's record. Each is for the endpoint the delivery used, so
-- a registration that replaced it meanwhile is left alone.

-- name: RecordPushSuccess :exec
UPDATE push_subscriptions SET last_success_at = now(), failures = 0
WHERE id = sqlc.arg(id)::uuid AND endpoint = sqlc.arg(endpoint)::text;

-- RecordPushFailure counts a failed attempt and says why. Failures never
-- delete a row, however many: a relay that is down would otherwise take
-- every device with it.
-- name: RecordPushFailure :exec
UPDATE push_subscriptions
SET failures = failures + 1, last_failure_at = now(), last_failure = sqlc.arg(reason)::text
WHERE id = sqlc.arg(id)::uuid AND endpoint = sqlc.arg(endpoint)::text;

-- DeleteGonePushSubscription removes a subscription the push service
-- said no longer exists (404 or 410): the one thing that deletes a row
-- here besides its session ending.
-- name: DeleteGonePushSubscription :exec
DELETE FROM push_subscriptions
WHERE id = sqlc.arg(id)::uuid AND endpoint = sqlc.arg(endpoint)::text;

-- PushDeliveryStats is the Diagnostics row's counts: every subscription,
-- and those whose last attempt failed.
-- name: PushDeliveryStats :one
SELECT count(*)::int AS devices, (count(*) FILTER (WHERE failures > 0))::int AS failing
FROM push_subscriptions;

-- PushFailureReasons is the failing subscriptions by why, the most
-- recent first.
-- name: PushFailureReasons :many
SELECT last_failure AS reason, count(*)::int AS devices, max(last_failure_at)::timestamptz AS latest
FROM push_subscriptions
WHERE failures > 0
GROUP BY last_failure
ORDER BY latest DESC
LIMIT sqlc.arg(max_reasons)::int;
