-- +goose Up
-- Owned by the chat module. Who may read a channel: the members of its
-- space, or the participants of the direct message. Every query that
-- asks "may this person read this channel" reads this view.
CREATE VIEW channel_readers AS
SELECT c.id AS channel_id, sm.user_id
FROM channels c
JOIN space_members sm ON sm.space_id = c.space_id
UNION ALL
SELECT dm.channel_id, dm.user_id
FROM dm_members dm;

-- +goose Down
DROP VIEW channel_readers;
