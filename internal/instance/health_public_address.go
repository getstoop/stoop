package instance

import (
	"context"
)

// PublicAddressCheck is the Health row for how people reach the server,
// from the same state GetReachability reports. It lives here rather than
// in internal/app because that state is this module's.
func (s *Service) PublicAddressCheck() HealthCheck {
	return HealthCheck{Name: "public_address", FixTab: "hosting", Run: s.publicAddress}
}

func (s *Service) publicAddress(ctx context.Context) (CheckState, string) {
	r, err := s.Reachability(ctx)
	if err != nil {
		return CheckDanger, "could not read settings: " + err.Error()
	}
	url, err := s.PublicURL(ctx)
	if err != nil {
		return CheckDanger, "could not read settings: " + err.Error()
	}
	if r.CloudflareTunnel.Enabled {
		st := CloudflareTunnelStatus{State: "stopped"}
		if s.tunnel != nil {
			st = s.tunnel.Status()
		}
		if st.State != "running" {
			return CheckWarn, "Cloudflare Tunnel " + st.State + orError(st.Error)
		}
	}
	if r.Tailscale.Enabled {
		st := TailscaleStatus{State: "stopped"}
		if s.tailscale != nil {
			st = s.tailscale.Status(ctx)
		}
		if st.State != "running" {
			return CheckWarn, "Tailscale " + st.State + orError(st.Error)
		}
	}
	if url == "" {
		if r.CloudflareTunnel.Enabled {
			return CheckWarn, "tunnel running · no public address set"
		}
		return CheckOff, "use the address you're on"
	}
	return CheckOK, url
}

func orError(e string) string {
	if e == "" {
		return ""
	}
	return ": " + e
}
