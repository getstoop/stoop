package instance

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/getstoop/stoop/internal/mail"
)

// keyLastSend is the last send's outcome, for the Email health row. In
// the database because `stoop jobs` can be its own process.
const keyLastSend = "smtp_last_send"

// SendOutcome is how the last send went; a zero At is nothing sent yet.
type SendOutcome struct {
	At    time.Time `json:"at"`
	OK    bool      `json:"ok"`
	Error string    `json:"error"`
}

// LastSend is the outcome of the last send, test or real.
func (s *Service) LastSend(ctx context.Context) (SendOutcome, error) {
	var outcome SendOutcome
	_, err := s.readJSON(ctx, keyLastSend, &outcome)
	return outcome, err
}

// recordSend saves a send's outcome. A failure to save is logged: the
// send itself already happened.
func (s *Service) recordSend(ctx context.Context, sendErr error) {
	outcome := SendOutcome{At: time.Now().UTC(), OK: sendErr == nil}
	var refusal *mail.Refusal
	switch {
	case errors.As(sendErr, &refusal):
		outcome.Error = refusal.Message
	case sendErr != nil:
		outcome.Error = sendErr.Error()
	}
	if err := s.writeJSON(context.WithoutCancel(ctx), keyLastSend, outcome); err != nil {
		slog.Error("record email outcome", "err", err)
	}
}
