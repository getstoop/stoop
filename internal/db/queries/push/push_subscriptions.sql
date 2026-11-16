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
    created_at = now(), last_success_at = NULL, failures = 0;

-- name: SetPushSubscriptionKinds :execrows
UPDATE push_subscriptions SET kinds = sqlc.arg(kinds)::integer[]
WHERE credential_id = sqlc.arg(credential_id)::uuid;

-- name: DeletePushSubscription :exec
DELETE FROM push_subscriptions WHERE credential_id = $1;
