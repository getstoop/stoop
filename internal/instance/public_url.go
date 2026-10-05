package instance

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/config"
)

const keyPublicURL = "public_url"

// PublicURL is the address in force, or the built-in Tailscale
// listener's address (via UsePublicURL) when none is set.
func (s *Service) PublicURL(ctx context.Context) (string, error) {
	r, err := s.Reachability(ctx)
	if err != nil {
		return "", err
	}
	if r.PublicURL != "" {
		return r.PublicURL, nil
	}
	return s.publicURL(), nil
}

func validatePublicURL(raw string) (string, error) {
	if !config.Origin(raw) {
		return "", apierr.Field(connect.CodeInvalidArgument, "public_url",
			errors.New("the public address must look like https://chat.example.com"))
	}
	return strings.TrimSuffix(raw, "/"), nil
}

// stagePublicURL validates a save of the address; empty clears it.
func stagePublicURL(msg *instancev1.UpdateReachabilityRequest, _ Reachability, save *settingSave) error {
	if msg.PublicUrl == nil {
		return nil
	}
	publicURL := strings.TrimSpace(*msg.PublicUrl)
	if publicURL != "" {
		var err error
		if publicURL, err = validatePublicURL(publicURL); err != nil {
			return err
		}
	}
	save.write(keyPublicURL, publicURL)
	return nil
}
