package instance

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/mail"
)

var _ mail.Sender = (*Service)(nil)

// Send delivers msg with the saved settings, within the hourly cap, and
// records the outcome for the Email health row.
func (s *Service) Send(ctx context.Context, msg mail.Message) error {
	return errors.New("sending email is not built yet")
}

func (s *Service) SendTestEmail(ctx context.Context, req *connect.Request[instancev1.SendTestEmailRequest]) (*connect.Response[instancev1.SendTestEmailResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("test email is not built yet"))
}
