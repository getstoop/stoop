-- +goose Up
-- Owned by the chat module. The feed behind the rail's pulse icon is
-- "activity"; "notification" now means only the ways Stoop asks for
-- attention (docs/design/activity-and-notifications.md). Names only —
-- the columns, indexes and constraints are unchanged.
ALTER TABLE notifications RENAME TO activity_items;
ALTER INDEX notifications_pkey RENAME TO activity_items_pkey;
ALTER INDEX notifications_user_recent_idx RENAME TO activity_items_user_recent_idx;
ALTER INDEX notifications_user_unread_idx RENAME TO activity_items_user_unread_idx;
ALTER TABLE activity_items RENAME CONSTRAINT notifications_kind_valid TO activity_items_kind_valid;
ALTER TABLE activity_items RENAME CONSTRAINT notifications_user_id_fkey TO activity_items_user_id_fkey;
ALTER TABLE activity_items RENAME CONSTRAINT notifications_space_id_fkey TO activity_items_space_id_fkey;
ALTER TABLE activity_items RENAME CONSTRAINT notifications_channel_id_fkey TO activity_items_channel_id_fkey;
ALTER TABLE activity_items RENAME CONSTRAINT notifications_message_id_fkey TO activity_items_message_id_fkey;
ALTER TABLE activity_items RENAME CONSTRAINT notifications_actor_id_fkey TO activity_items_actor_id_fkey;

-- +goose Down
ALTER TABLE activity_items RENAME CONSTRAINT activity_items_actor_id_fkey TO notifications_actor_id_fkey;
ALTER TABLE activity_items RENAME CONSTRAINT activity_items_message_id_fkey TO notifications_message_id_fkey;
ALTER TABLE activity_items RENAME CONSTRAINT activity_items_channel_id_fkey TO notifications_channel_id_fkey;
ALTER TABLE activity_items RENAME CONSTRAINT activity_items_space_id_fkey TO notifications_space_id_fkey;
ALTER TABLE activity_items RENAME CONSTRAINT activity_items_user_id_fkey TO notifications_user_id_fkey;
ALTER TABLE activity_items RENAME CONSTRAINT activity_items_kind_valid TO notifications_kind_valid;
ALTER INDEX activity_items_user_unread_idx RENAME TO notifications_user_unread_idx;
ALTER INDEX activity_items_user_recent_idx RENAME TO notifications_user_recent_idx;
ALTER INDEX activity_items_pkey RENAME TO notifications_pkey;
ALTER TABLE activity_items RENAME TO notifications;
