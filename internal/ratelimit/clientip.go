package ratelimit

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// ClientIP identifies the caller for keying a bucket. remoteAddr is the
// TCP peer ("ip:port"); trusts reports whether an address is a proxy
// whose forwarded headers may be believed, and is asked about each hop.
//
// Proxies append to X-Forwarded-For, so the client is the rightmost
// address that isn't a proxy of ours; anything further left was written
// by the caller and is a lie waiting to happen. See
// docs/self-hosting.md, "Trusted proxies".
func ClientIP(remoteAddr string, h http.Header, trusts func(addr string) bool) string {
	peer := peerKey(remoteAddr)
	if !trusts(remoteAddr) {
		return peer
	}
	// A proxy may add its hop as a second header line rather than on
	// the first; the lines together are one chain.
	hops := strings.Split(strings.Join(h.Values("X-Forwarded-For"), ","), ",")
	// STOOP_TRUST_PROXY=true trusts every hop, so the walk below would
	// skip them all. The last one is what the proxy itself appended.
	if trustsEveryone(trusts) {
		if key := addrKey(hops[len(hops)-1]); key != "" {
			return key
		}
		return peer
	}
	for i := len(hops) - 1; i >= 0; i-- {
		key := addrKey(hops[i])
		if key == "" {
			return peer
		}
		if !trusts(key) {
			return key
		}
	}
	return peer
}

// trustsEveryone reports the blunt trust-everything mode: a predicate
// that believes even a peer that is not an address at all.
func trustsEveryone(trusts func(addr string) bool) bool { return trusts(notAnAddress) }

const notAnAddress = "-"

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
