-- +goose Up
-- Whether a space uses voice channels; off hides them. See
-- docs/architecture/voice.md#turning-voice-off.
ALTER TABLE spaces ADD COLUMN voice_enabled boolean NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE spaces DROP COLUMN voice_enabled;
