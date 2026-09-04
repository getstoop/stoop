-- +goose Up
-- Link previews for URLs posted in messages. Owned by the chat module.
-- One row per URL, shared by every message that links it; state is
-- 'pending' until the fetcher has been, then 'ok' or 'failed'. Rows are
-- refetched when older than the refresh window.
CREATE TABLE link_previews (
    url           text PRIMARY KEY,
    state         text NOT NULL DEFAULT 'pending' CONSTRAINT link_previews_state_valid CHECK (state IN ('pending', 'ok', 'failed')),
    fetched_at    timestamptz,
    title         text NOT NULL DEFAULT '',
    description   text NOT NULL DEFAULT '',
    site_name     text NOT NULL DEFAULT '',
    -- A file owned by the files module (kind link_preview).
    image_file_id uuid REFERENCES files (id) ON DELETE SET NULL,
    image_width   int  NOT NULL DEFAULT 0,
    image_height  int  NOT NULL DEFAULT 0
);

CREATE TABLE message_links (
    message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    position   int  NOT NULL,
    url        text NOT NULL REFERENCES link_previews (url) ON DELETE CASCADE,
    PRIMARY KEY (message_id, position)
);

-- +goose Down
DROP TABLE message_links;
DROP TABLE link_previews;
