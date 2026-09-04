package instance

import (
	"net"
	"net/netip"
)

// tailnetRange is the CGNAT block Tailscale hands out addresses from.
var tailnetRange = netip.MustParsePrefix("100.64.0.0/10")

// hostHasTailscale reports whether this machine runs the Tailscale client:
// some interface carries a tailnet address. The built-in tsnet listener
// doesn't count — it is userspace and gives LiveKit nothing — which is
// exactly the distinction the reachability page needs to make for voice.
func hostHasTailscale() bool {
	ifaces, err := net.Interfaces()
	if err != nil {
		return false
	}
	for _, i := range ifaces {
		if i.Flags&net.FlagUp == 0 {
			continue
		}
		addrs, err := i.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			if ip, ok := netip.AddrFromSlice(ipn.IP); ok && tailnetRange.Contains(ip.Unmap()) {
				return true
			}
		}
	}
	return false
}
