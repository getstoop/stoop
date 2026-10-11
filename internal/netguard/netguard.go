// Package netguard is the one egress guard for server-side requests to
// URLs somebody else chose: link previews and outgoing webhooks. It
// resolves a name, checks every address against the policy, and dials
// the address it checked. See docs/architecture/integrations.md → Egress.
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

	"golang.org/x/net/proxy"
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

// SOCKS5Transport sends every request through the SOCKS5 proxy at
// proxyAddr (host:port), which also resolves the name, so the server
// itself contacts nothing but the proxy. The policy can only be applied
// to a host written as an address: what a name reaches is the proxy's to
// decide. See docs/architecture/messaging.md → Link previews.
func (p Policy) SOCKS5Transport(proxyAddr string) (*http.Transport, error) {
	dialer, err := proxy.SOCKS5("tcp", proxyAddr, nil, &net.Dialer{Timeout: 5 * time.Second})
	if err != nil {
		return nil, err
	}
	viaProxy, ok := dialer.(proxy.ContextDialer)
	if !ok {
		return nil, errors.New("the SOCKS5 dialer takes no context")
	}
	return p.transport(func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, _, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		if ip, err := netip.ParseAddr(host); err == nil && !p.Allows(ip) {
			return nil, fmt.Errorf("%s: %w", ip, ErrNotPublic)
		}
		return viaProxy.DialContext(ctx, network, addr)
	}), nil
}

// Transport dials only addresses the policy allows, resolving once and
// dialing what it checked, and never routes through a proxy.
func (p Policy) Transport() *http.Transport {
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	return p.transport(func(ctx context.Context, network, addr string) (net.Conn, error) {
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
	})
}

func (p Policy) transport(dial func(ctx context.Context, network, addr string) (net.Conn, error)) *http.Transport {
	return &http.Transport{
		Proxy:                  nil,
		DialContext:            dial,
		TLSHandshakeTimeout:    5 * time.Second,
		ResponseHeaderTimeout:  8 * time.Second,
		MaxResponseHeaderBytes: 64 << 10,
		DisableKeepAlives:      true,
	}
}
