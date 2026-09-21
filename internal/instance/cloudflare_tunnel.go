package instance

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/getstoop/stoop/internal/apierr"
)

const keyCloudflareTunnel = "cloudflare_tunnel"

// CloudflareTunnelSettings control the cloudflared Stoop runs.
type CloudflareTunnelSettings struct {
	Enabled bool   `json:"enabled"`
	Token   string `json:"token"`
}

// CloudflareTunnelStatus is reported by the connector.
type CloudflareTunnelStatus struct {
	Enabled bool
	State   string
	Error   string
}

// CloudflareTunnelController is the instance module's port to the
// connector. Implemented by cftunnel.Manager, wired in internal/app.
type CloudflareTunnelController interface {
	Apply(CloudflareTunnelSettings)
	Status() CloudflareTunnelStatus
}

// UseCloudflareTunnel connects the connector and applies the settings in
// force right away.
func (s *Service) UseCloudflareTunnel(ctx context.Context, c CloudflareTunnelController) error {
	s.tunnel = c
	if c == nil {
		return nil
	}
	r, err := s.Reachability(ctx)
	if err != nil {
		return err
	}
	c.Apply(r.CloudflareTunnel)
	return nil
}

// ParseTunnelToken checks a token decodes the way cloudflared decodes it:
// padded base64 of JSON with an account tag, a tunnel id that is a UUID,
// and a secret that is itself base64. That way what saves here is what
// the connector will accept.
func ParseTunnelToken(token string) (string, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return "", nil
	}
	bad := apierr.Field(connect.CodeInvalidArgument, "cloudflare_tunnel.token",
		errors.New("that isn't a tunnel token; copy it from the tunnel's page in Cloudflare"))
	raw, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return "", bad
	}
	var parts struct {
		Account string    `json:"a"`
		Tunnel  uuid.UUID `json:"t"`
		Secret  []byte    `json:"s"`
	}
	if json.Unmarshal(raw, &parts) != nil || parts.Account == "" || parts.Tunnel == uuid.Nil || len(parts.Secret) == 0 {
		return "", bad
	}
	return token, nil
}

// updateCloudflareTunnel saves and applies; a blank token keeps the
// saved one. The environment's token is never copied into the database:
// a saved blank falls back to it (see Reachability), so editing .env
// keeps working.
func (s *Service) updateCloudflareTunnel(ctx context.Context, enabled bool, token string) error {
	token, err := ParseTunnelToken(token)
	if err != nil {
		return err
	}
	if token == "" {
		var prev CloudflareTunnelSettings
		if _, err := s.readJSON(ctx, keyCloudflareTunnel, &prev); err != nil {
			return err
		}
		token = prev.Token
	}
	if enabled && token == "" && s.env.CloudflareTunnel.Token == "" {
		return apierr.Field(connect.CodeInvalidArgument, "cloudflare_tunnel.token",
			errors.New("a Cloudflare Tunnel needs the tunnel's token"))
	}
	t := CloudflareTunnelSettings{Enabled: enabled, Token: token}
	if err := s.writeJSON(ctx, keyCloudflareTunnel, t); err != nil {
		return err
	}
	if s.tunnel != nil {
		if t.Token == "" {
			t.Token = s.env.CloudflareTunnel.Token
		}
		s.tunnel.Apply(t)
	}
	return nil
}
