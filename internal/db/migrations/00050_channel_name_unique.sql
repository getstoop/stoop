-- +goose Up
-- Owned by the chat module. Channel names are unique per space, ignoring
-- case. The rule arrived in 0.3.0, so an older space can hold two names
-- that differ only by case: the oldest keeps its name and each later one
-- gets the first free -2, -3, … suffix.
-- +goose StatementBegin
DO $$
DECLARE
    clash  record;
    suffix int;
BEGIN
    FOR clash IN
        SELECT id, space_id, name FROM (
            SELECT id, space_id, name,
                   row_number() OVER (PARTITION BY space_id, lower(name) ORDER BY created_at, id) AS rank
            FROM channels WHERE space_id IS NOT NULL
        ) ranked
        WHERE rank > 1
        ORDER BY space_id, lower(name), rank
    LOOP
        suffix := 2;
        WHILE EXISTS (
            SELECT 1 FROM channels
            WHERE space_id = clash.space_id AND lower(name) = lower(clash.name || '-' || suffix)
        ) LOOP
            suffix := suffix + 1;
        END LOOP;
        UPDATE channels SET name = clash.name || '-' || suffix WHERE id = clash.id;
    END LOOP;
END $$;
-- +goose StatementEnd

CREATE UNIQUE INDEX channels_space_name_uniq ON channels (space_id, lower(name));

-- +goose Down
DROP INDEX channels_space_name_uniq;
