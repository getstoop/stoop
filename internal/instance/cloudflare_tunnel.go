package instance

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"

	"connectrpc.com/connect"
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
func ParseTunnelToken(pasted string) (string, error) {
	fields := strings.Fields(pasted)
	if len(fields) == 0 {
		return "", nil
	}
	token := fields[len(fields)-1]
	raw, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		raw, err = base64.RawStdEncoding.DecodeString(token)
	}
	var parts struct {
		Account string `json:"a"`
		Tunnel  string `json:"t"`
		Secret  string `json:"s"`
	}
	if err != nil || json.Unmarshal(raw, &parts) != nil || parts.Account == "" || parts.Tunnel == "" || parts.Secret == "" {
		return "", connect.NewError(connect.CodeInvalidArgument,
			errors.New("that isn't a tunnel token; copy it from the tunnel's page in Cloudflare"))
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
