package unfurl

import "net/netip"

type netipAddr = netip.Addr

// 100.64.0.0/10 is carrier-grade NAT space (also Tailscale's range): not
// public, and exactly the kind of address a self-hoster's other services
// live on.
var cgnat = netip.MustParsePrefix("100.64.0.0/10")

func isCGNAT(ip netip.Addr) bool { return cgnat.Contains(ip) }
