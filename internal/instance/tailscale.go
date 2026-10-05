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

const keyTailscale = "tailscale"

// TailscaleSettings control the built-in Tailscale listener.
type TailscaleSettings struct {
	Enabled    bool   `json:"enabled"`
	Hostname   string `json:"hostname"`
	Funnel     bool   `json:"funnel"`
	AuthKey    string `json:"auth_key"`
	ControlURL string `json:"control_url"`
}

// TailscaleController is the instance module's port to the built-in
// listener: apply settings, report status. Implemented by
// tailnet.Manager, wired in internal/app.
type TailscaleController interface {
	Apply(TailscaleSettings)
	Status(ctx context.Context) TailscaleStatus
}

// TailscaleStatus is reported by the built-in Tailscale listener.
type TailscaleStatus struct {
	Enabled  bool
	State    string
	LoginURL string
	URL      string
	Funnel   bool
	Error    string
	// TailnetIP is the node's 100.x address; the one LiveKit is told to
	// advertise so voice over the tailnet finds the media ports.
	TailnetIP string
	// CarriesVoice reports whether the node is relaying LiveKit's media
	// ports.
	CarriesVoice bool
}

// UseTailscale connects the built-in listener; nil means the build has
// none. The settings in force are applied right away.
func (s *Service) UseTailscale(ctx context.Context, c TailscaleController) error {
	s.tailscale = c
	if c == nil {
		return nil
	}
	r, err := s.Reachability(ctx)
	if err != nil {
		return err
	}
	c.Apply(r.Tailscale)
	return nil
}

func validHostname(h string) bool {
	if len(h) > 63 {
		return false
	}
	for i, c := range h {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case c == '-' && i > 0 && i < len(h)-1:
		default:
			return false
		}
	}
	return h != ""
}

// stageTailscale validates a save of the listener's settings and tells
// the listener once it has committed.
func (s *Service) stageTailscale(msg *instancev1.UpdateReachabilityRequest, current Reachability, save *settingSave) error {
	in := msg.Tailscale
	if in == nil {
		return nil
	}
	settings := TailscaleSettings{
		Enabled: in.Enabled, Hostname: strings.TrimSpace(in.Hostname), Funnel: in.Funnel,
		AuthKey:    keepSecret(strings.TrimSpace(in.AuthKey), current.Tailscale.AuthKey),
		ControlURL: strings.TrimSpace(in.ControlUrl),
	}
	if settings.Hostname != "" && !validHostname(settings.Hostname) {
		return apierr.Field(connect.CodeInvalidArgument, "tailscale.hostname",
			errors.New("the node name must be letters, digits, and hyphens"))
	}
	if settings.ControlURL != "" {
		if _, ok := config.HTTPURL(settings.ControlURL); !ok {
			return apierr.Field(connect.CodeInvalidArgument, "tailscale.control_url",
				errors.New("the control URL must be an http(s) URL"))
		}
	}
	save.write(keyTailscale, settings)
	save.then(func() {
		if s.tailscale != nil {
			s.tailscale.Apply(settings)
		}
	})
	return nil
}

func (settings TailscaleSettings) toProto() *instancev1.TailscaleSettings {
	return &instancev1.TailscaleSettings{
		Enabled: settings.Enabled, Hostname: settings.Hostname, Funnel: settings.Funnel,
		HasAuthKey: settings.AuthKey != "", ControlUrl: settings.ControlURL,
	}
}

func (status TailscaleStatus) toProto() *instancev1.TailscaleStatus {
	return &instancev1.TailscaleStatus{
		Enabled: status.Enabled, State: status.State, LoginUrl: status.LoginURL,
		Url: status.URL, Funnel: status.Funnel, Error: status.Error,
		TailnetIp: status.TailnetIP, CarriesVoice: status.CarriesVoice,
	}
}
