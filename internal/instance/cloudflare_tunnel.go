package instance

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"
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
	URL     string
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

// ParseTunnelToken takes what was pasted (the token, or the whole
// `cloudflared … <token>` command Cloudflare shows) and returns the token.
// It decodes the way cloudflared does, so what saves here is what the
// connector will accept: padded base64 of JSON with an account tag, a
// tunnel id that is a UUID, and a secret that is itself base64.
func ParseTunnelToken(pasted string) (string, error) {
	fields := strings.Fields(pasted)
	if len(fields) == 0 {
		return "", nil
	}
	token := fields[len(fields)-1]
	bad := connect.NewError(connect.CodeInvalidArgument,
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
// saved one.
func (s *Service) updateCloudflareTunnel(ctx context.Context, enabled bool, pasted string) error {
	token, err := ParseTunnelToken(pasted)
	if err != nil {
		return err
	}
	if token == "" {
		r, err := s.Reachability(ctx)
		if err != nil {
			return err
		}
		token = r.CloudflareTunnel.Token
	}
	if enabled && token == "" {
		return connect.NewError(connect.CodeInvalidArgument,
			errors.New("a Cloudflare Tunnel needs the tunnel's token"))
	}
	t := CloudflareTunnelSettings{Enabled: enabled, Token: token}
	if err := s.writeJSON(ctx, keyCloudflareTunnel, t); err != nil {
		return err
	}
	if s.tunnel != nil {
		s.tunnel.Apply(t)
	}
	return nil
}
