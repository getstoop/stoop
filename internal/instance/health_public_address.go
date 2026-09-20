package instance

import (
	"context"
	"sync"
	"time"
)

// downDanger is how long a configured tunnel or tailnet may be down
// before the row turns from warn to danger (docs/proposals/diagnostics.md).
const downDanger = time.Minute

// PublicAddressCheck is the Health row for how people reach the server,
// from the same state GetReachability reports. It lives here rather than
// in internal/app because that state is this module's.
func (s *Service) PublicAddressCheck() HealthCheck {
	c := &publicAddressCheck{svc: s}
	return HealthCheck{Name: "public_address", FixTab: "hosting", Run: c.run}
}

type publicAddressCheck struct {
	svc *Service

	mu        sync.Mutex
	downSince time.Time
}

func (c *publicAddressCheck) run(ctx context.Context) (CheckState, string) {
	s := c.svc
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
			return c.down(time.Now()), "Cloudflare Tunnel " + st.State + orError(st.Error)
		}
	}
	if r.Tailscale.Enabled {
		st := TailscaleStatus{State: "stopped"}
		if s.tailscale != nil {
			st = s.tailscale.Status(ctx)
		}
		if st.State != "running" {
			return c.down(time.Now()), "Tailscale " + st.State + orError(st.Error)
		}
	}
	c.up()
	if url == "" {
		if r.CloudflareTunnel.Enabled {
			return CheckWarn, "tunnel running · no public address set"
		}
		return CheckOff, "use the address you're on"
	}
	return CheckOK, url
}

// down records the first sighting of a stopped tunnel or tailnet and
// answers warn until it has been down for downDanger.
func (c *publicAddressCheck) down(now time.Time) CheckState {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.downSince.IsZero() {
		c.downSince = now
	}
	if now.Sub(c.downSince) >= downDanger {
		return CheckDanger
	}
	return CheckWarn
}

func (c *publicAddressCheck) up() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.downSince = time.Time{}
}

func orError(e string) string {
	if e == "" {
		return ""
	}
	return ": " + e
}
