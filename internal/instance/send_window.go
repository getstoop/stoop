package instance

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/mail"
)

// keySendWindow is the outbound cap's fixed one-hour window, counted in
// the database so it holds across processes.
const keySendWindow = "smtp_send_window"

type sendWindow struct {
	Start time.Time `json:"start"`
	Count int       `json:"count"`
}

// takeSendSlot counts one send against limit an hour; 0 is no cap. Over
// it, the error is a *mail.HourlyLimitError.
func (s *Service) takeSendSlot(ctx context.Context, limit int, now time.Time) error {
	if limit <= 0 {
		return nil
	}
	_, err := s.q.TakeSendSlot(ctx, dbgen.TakeSendSlotParams{
		Now: now, ExpiredBefore: now.Add(-time.Hour), HourlyLimit: int32(limit),
	})
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	var window sendWindow
	if _, err := s.readJSON(ctx, keySendWindow, &window); err != nil {
		return err
	}
	return &mail.HourlyLimitError{Limit: limit, Until: window.Start.Add(time.Hour)}
}
