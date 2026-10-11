package netguard

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"time"

	"golang.org/x/net/proxy"
)

// SOCKS5Transport sends every request through the SOCKS5 proxy at
// proxyAddr (host:port), so the server itself contacts nothing but the
// proxy. A name is looked up over HTTPS at resolverURL, through the proxy
// too; every address is checked against the policy and the proxy is told
// to connect to the address checked, never to the name. See
// docs/architecture/messaging.md → Through a proxy.
func (p Policy) SOCKS5Transport(proxyAddr, resolverURL string) (*http.Transport, error) {
	dialer, err := proxy.SOCKS5("tcp", proxyAddr, nil, &net.Dialer{Timeout: 5 * time.Second})
	if err != nil {
		return nil, err
	}
	viaProxy, ok := dialer.(proxy.ContextDialer)
	if !ok {
		return nil, errors.New("the SOCKS5 dialer takes no context")
	}
	resolver := newResolverClient(viaProxy.DialContext)
	return p.transport(func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		var ips []netip.Addr
		if ip, err := netip.ParseAddr(host); err == nil {
			ips = []netip.Addr{ip}
		} else if ips, err = resolveOverHTTPS(ctx, resolver, resolverURL, host); err != nil {
			return nil, err
		}
		for _, ip := range ips {
			if !p.Allows(ip) {
				return nil, fmt.Errorf("%s resolves to %s: %w", host, ip, ErrNotPublic)
			}
		}
		return viaProxy.DialContext(ctx, network, net.JoinHostPort(ips[0].Unmap().String(), port))
	}), nil
}
