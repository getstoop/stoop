// Package netguard is the one egress guard for server-side requests to
// URLs somebody else chose: link previews and outgoing webhooks. It
// resolves a name, checks every address against the policy, and dials
// the address it checked. See docs/proposals/webhooks.md → The sharp edge.
package netguard

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"time"
)

var (
	ErrNotPublic = errors.New("address is not a public host")
	ErrBadScheme = errors.New("only http and https URLs are allowed")
)

// Policy is what a caller may reach. Link-local, including the cloud
// metadata address, is refused whatever the policy says.
type Policy struct {
	// AllowPrivate admits RFC1918, CGNAT and loopback addresses.
	AllowPrivate bool
}

// cgnat is 100.64.0.0/10: carrier-grade NAT and Tailscale's range.
var cgnat = netip.MustParsePrefix("100.64.0.0/10")

// IsPublic reports whether ip is a globally routable unicast address.
func IsPublic(ip netip.Addr) bool {
	ip = ip.Unmap()
	return ip.IsValid() && ip.IsGlobalUnicast() &&
		!ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() &&
		!ip.IsMulticast() && !ip.IsUnspecified() && !cgnat.Contains(ip)
}

// Allows reports whether the policy admits ip.
func (p Policy) Allows(ip netip.Addr) bool {
	ip = ip.Unmap()
	if IsPublic(ip) {
		return true
	}
	if !p.AllowPrivate || !ip.IsValid() {
		return false
	}
	return (ip.IsPrivate() || ip.IsLoopback() || cgnat.Contains(ip)) && !ip.IsLinkLocalUnicast()
}

// CheckURL refuses anything but a plain http(s) URL with a host and no
// credentials.
func CheckURL(u *url.URL) error {
	if u.Scheme != "http" && u.Scheme != "https" {
		return ErrBadScheme
	}
	if u.Hostname() == "" || u.User != nil {
		return ErrBadScheme
	}
	return nil
}

// CheckHost resolves a URL's host now and applies the policy, for a
// refusal at save time.
func (p Policy) CheckHost(ctx context.Context, u *url.URL) error {
	if err := CheckURL(u); err != nil {
		return err
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", u.Hostname())
	if err != nil {
		return err
	}
	if len(ips) == 0 {
		return fmt.Errorf("%s: no addresses", u.Hostname())
	}
	for _, ip := range ips {
		if !p.Allows(ip) {
			return fmt.Errorf("%s resolves to %s: %w", u.Hostname(), ip, ErrNotPublic)
		}
	}
	return nil
}

// Transport dials only addresses the policy allows, resolving once and
// dialing what it checked, and never routes through a proxy.
func (p Policy) Transport() *http.Transport {
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	return &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
			if err != nil {
				return nil, err
			}
			if len(ips) == 0 {
				return nil, fmt.Errorf("%s: no addresses", host)
			}
			for _, ip := range ips {
				if !p.Allows(ip) {
					return nil, fmt.Errorf("%s resolves to %s: %w", host, ip, ErrNotPublic)
				}
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].Unmap().String(), port))
		},
		TLSHandshakeTimeout:    5 * time.Second,
		ResponseHeaderTimeout:  8 * time.Second,
		MaxResponseHeaderBytes: 64 << 10,
		DisableKeepAlives:      true,
	}
}
