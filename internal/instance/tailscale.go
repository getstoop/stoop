package instance

import (
	"context"
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
