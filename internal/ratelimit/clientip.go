package ratelimit

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// ClientIP identifies the caller for keying a bucket: an IPv4 address, or
// an IPv6 caller's /64 (bucketOf). remoteAddr is the
// TCP peer ("ip:port"); trusts reports whether an address is a proxy
// whose forwarded headers may be believed, and is asked about each hop.
//
// Proxies append to X-Forwarded-For, so the client is the rightmost
// address that isn't a proxy of ours; anything further left was written
// by the caller and is a lie waiting to happen. See
// docs/self-hosting/reaching-your-server.md, "Trusted proxies".
func ClientIP(remoteAddr string, h http.Header, trusts func(addr string) bool) string {
	peer := bucketOf(peerKey(remoteAddr))
	if !trusts(remoteAddr) {
		return peer
	}
	// A proxy may add its hop as a second header line rather than on
	// the first; the lines together are one chain.
	hops := strings.Split(strings.Join(h.Values("X-Forwarded-For"), ","), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		key := addrKey(hops[i])
		if key == "" {
			return peer
		}
		if !trusts(key) {
			return bucketOf(key)
		}
	}
	return peer
}

// addrKey normalizes one address to a bucket key, or "" if it is not an
// IP address.
func addrKey(s string) string {
	host := strings.TrimSpace(s)
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	addr, err := netip.ParseAddr(strings.Trim(host, "[]"))
	if err != nil {
		return ""
	}
	return addr.Unmap().WithZone("").String()
}

// peerKey keys the TCP peer, keeping whatever it is when it doesn't
// parse — an unusual listener still gets a bucket of its own.
func peerKey(remoteAddr string) string {
	if key := addrKey(remoteAddr); key != "" {
		return key
	}
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return remoteAddr
}

// bucketOf is the bucket for one caller address. An IPv6 host is routinely
// handed a whole /64, so a bucket per address would limit nothing; IPv4
// stays per address, as does anything that isn't an address.
func bucketOf(key string) string {
	addr, err := netip.ParseAddr(key)
	if err != nil || addr.Is4() {
		return key
	}
	return netip.PrefixFrom(addr, 64).Masked().String()
}
