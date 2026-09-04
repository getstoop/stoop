-- +goose Up
-- Where a space puts someone who hasn't chosen a channel: a new member
-- arriving on an invite, or anyone opening the space with no channel in
-- the URL. Unset means "whichever channel sorts first", which is what
-- everyone got before this column existed.
--
-- ON DELETE SET NULL because the pointer must not outlive what it points
-- at: deleting the chosen channel silently returns the space to the
-- default it had, rather than leaving a link to a channel that is gone.
ALTER TABLE spaces
    ADD COLUMN default_channel_id uuid REFERENCES channels (id) ON DELETE SET NULL;

-- +goose Down
ALTER TABLE spaces DROP COLUMN default_channel_id;
