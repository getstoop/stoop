package instance

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"

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
