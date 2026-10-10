-- +goose Up
-- Owned by the auth module. Password reset links share email_tokens.
ALTER TABLE email_tokens DROP CONSTRAINT email_tokens_purpose_check,
    ADD CONSTRAINT email_tokens_purpose_check
        CHECK (purpose IN ('confirm_email', 'reset_password'));

-- +goose Down
DELETE FROM email_tokens WHERE purpose = 'reset_password';
ALTER TABLE email_tokens DROP CONSTRAINT email_tokens_purpose_check,
    ADD CONSTRAINT email_tokens_purpose_check CHECK (purpose IN ('confirm_email'));
