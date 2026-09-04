// Package trustedproxy decides whether a request's forwarded headers can
// be believed.
//
// X-Forwarded-For and X-Forwarded-Proto are trivially spoofable: anyone
// who can open a socket sets them to whatever they like. Believing them
// unconditionally hands out a fresh rate-limit bucket per made-up address
// and lets a plain connection claim it arrived over HTTPS. So they are
// honoured only when the peer — the machine that actually opened the
// connection — is one the operator named as their proxy.
package trustedproxy

import (
	"fmt"
	"net"
	"net/netip"
	"strings"
)

// Set is the operator's answer to "what is in front of this server?".
// The zero value trusts nothing, which is the right default for a server
// whose port is reachable directly.
type Set struct {
	// all trusts every peer: STOOP_TRUST_PROXY=true, kept for servers
	// configured before addresses could be named.
	all      bool
	prefixes []netip.Prefix
}

// All trusts any peer's forwarded headers.
func All() Set { return Set{all: true} }

// Parse builds a set from CIDRs ("10.0.0.0/8") and bare addresses
// ("192.168.1.5", which means that address alone). Blank entries are
// skipped so a comma-separated form field can be sloppy.
func Parse(entries []string) (Set, error) {
	var s Set
	for _, raw := range entries {
		e := strings.TrimSpace(raw)
		if e == "" {
			continue
		}
		if p, err := netip.ParsePrefix(e); err == nil {
			s.prefixes = append(s.prefixes, p.Masked())
			continue
		}
		addr, err := netip.ParseAddr(e)
		if err != nil {
			return Set{}, fmt.Errorf("%q is not an IP address or CIDR range", e)
		}
		s.prefixes = append(s.prefixes, netip.PrefixFrom(addr, addr.BitLen()))
	}
	return s, nil
}

// TrustsEveryone reports the blunt legacy mode: every peer believed,
// with no addresses named.
func (s Set) TrustsEveryone() bool { return s.all }

// Empty reports whether nothing is trusted.
func (s Set) Empty() bool { return !s.all && len(s.prefixes) == 0 }

// Strings renders the set back for the API and the form.
func (s Set) Strings() []string {
	out := make([]string, 0, len(s.prefixes))
	for _, p := range s.prefixes {
		if p.Bits() == p.Addr().BitLen() {
			out = append(out, p.Addr().String())
			continue
		}
		out = append(out, p.String())
	}
	return out
}

// Trusted reports whether remoteAddr — an "ip:port" peer, or a bare IP —
// is a proxy whose forwarded headers may be believed.
func (s Set) Trusted(remoteAddr string) bool {
	if s.all {
		return true
	}
	if len(s.prefixes) == 0 {
		return false
	}
	host := remoteAddr
	if h, _, err := net.SplitHostPort(remoteAddr); err == nil {
		host = h
	}
	addr, err := netip.ParseAddr(strings.Trim(host, "[]"))
	if err != nil {
		return false
	}
	// A v4-mapped v6 peer (::ffff:10.0.0.2) is the v4 address.
	addr = addr.Unmap().WithZone("")
	for _, p := range s.prefixes {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}
