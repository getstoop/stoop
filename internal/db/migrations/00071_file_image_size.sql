-- +goose Up
-- Owned by the files module. An image attachment's width and height,
-- read from its header at upload with the EXIF orientation applied, so a
-- client can size the image before it loads. NULL when unknown: not an
-- image, a header that would not read, or uploaded before this column.
ALTER TABLE files ADD COLUMN width integer;
ALTER TABLE files ADD COLUMN height integer;

-- +goose Down
ALTER TABLE files DROP COLUMN height;
ALTER TABLE files DROP COLUMN width;
