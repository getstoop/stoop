package instance

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
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

// cloudflareTunnelSetting validates a save of the group; a blank token
// keeps the one in force.
func cloudflareTunnelSetting(enabled bool, token string, current CloudflareTunnelSettings) (CloudflareTunnelSettings, error) {
	token, err := ParseTunnelToken(token)
	if err != nil {
		return CloudflareTunnelSettings{}, err
	}
	token = keepSecret(token, current.Token)
	if enabled && token == "" {
		return CloudflareTunnelSettings{}, apierr.Field(connect.CodeInvalidArgument, "cloudflare_tunnel.token",
			errors.New("a Cloudflare Tunnel needs the tunnel's token"))
	}
	return CloudflareTunnelSettings{Enabled: enabled, Token: token}, nil
}

// stageCloudflareTunnel validates a save of the connector's settings and
// tells the connector once it has committed.
func (s *Service) stageCloudflareTunnel(msg *instancev1.UpdateReachabilityRequest, current Reachability, save *settingSave) error {
	in := msg.CloudflareTunnel
	if in == nil {
		return nil
	}
	tunnel, err := cloudflareTunnelSetting(in.Enabled, in.Token, current.CloudflareTunnel)
	if err != nil {
		return err
	}
	save.write(keyCloudflareTunnel, tunnel)
	save.then(func() {
		if s.tunnel != nil {
			s.tunnel.Apply(tunnel)
		}
	})
	return nil
}

func (tunnel CloudflareTunnelSettings) toProto() *instancev1.CloudflareTunnelSettings {
	return &instancev1.CloudflareTunnelSettings{Enabled: tunnel.Enabled, HasToken: tunnel.Token != ""}
}

func (status CloudflareTunnelStatus) toProto() *instancev1.CloudflareTunnelStatus {
	return &instancev1.CloudflareTunnelStatus{Enabled: status.Enabled, State: status.State, Error: status.Error}
}
