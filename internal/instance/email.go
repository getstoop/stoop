package instance

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/mail"
)

const keySMTP = "smtp"

// DefaultHourlyLimit caps a row saved without one.
const DefaultHourlyLimit = 100

// SMTP is the server Stoop sends mail through.
type SMTP struct {
	Enabled     bool          `json:"enabled"`
	Host        string        `json:"host"`
	Port        int           `json:"port"`
	Security    mail.Security `json:"security"`
	Username    string        `json:"username"`
	Password    string        `json:"password"`
	FromAddress string        `json:"from_address"`
	FromName    string        `json:"from_name"`
	HourlyLimit int           `json:"hourly_limit"`
}

// SMTPSettings is the saved server; a row without hourly_limit reads as
// DefaultHourlyLimit.
func (s *Service) SMTPSettings(ctx context.Context) (SMTP, error) {
	smtp := SMTP{HourlyLimit: DefaultHourlyLimit}
	_, err := s.readJSON(ctx, keySMTP, &smtp)
	return smtp, err
}

func (s *Service) GetEmailSettings(ctx context.Context, _ *connect.Request[instancev1.GetEmailSettingsRequest]) (*connect.Response[instancev1.GetEmailSettingsResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("email settings are not built yet"))
}

func (s *Service) UpdateEmailSettings(ctx context.Context, req *connect.Request[instancev1.UpdateEmailSettingsRequest]) (*connect.Response[instancev1.UpdateEmailSettingsResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("email settings are not built yet"))
}
