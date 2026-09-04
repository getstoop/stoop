package ratelimit

import (
	"net/http"
	"strings"
	"testing"

	"github.com/Jhut89/stoop/internal/trustedproxy"
)

// TestClientIP walks the forwarded chain from the right. Proxies append,
// so anything left of the last hop we know is the caller's own text.
func TestClientIP(t *testing.T) {
	// 10.0.0.0/8 is the local proxy, 2400:cb00::/32 a Cloudflare range.
	set, err := trustedproxy.Parse([]string{"10.0.0.0/8", "2400:cb00::/32"})
	if err != nil {
		t.Fatal(err)
	}
	named := set.Trusted
	everyone := trustedproxy.All().Trusted

	cases := []struct {
		name   string
		peer   string
		xff    string
		trusts func(string) bool
		want   string
	}{
		{"untrusted peer ignores the header", "8.8.8.8:5000", "203.0.113.9", named, "8.8.8.8"},
		{"no header at all", "10.0.0.1:5000", "", named, "10.0.0.1"},
		{"single hop", "10.0.0.1:5000", "203.0.113.9", named, "203.0.113.9"},
		{"chained through a second proxy", "10.0.0.1:5000", "203.0.113.9, 10.0.0.2", named, "203.0.113.9"},
		{"spoofed prefix is skipped", "10.0.0.1:5000", "1.2.3.4, 203.0.113.9", named, "203.0.113.9"},
		{"spoofed chain, several entries", "10.0.0.1:5000", "1.2.3.4, 5.6.7.8, 203.0.113.9, 10.0.0.2", named, "203.0.113.9"},
		{"every hop is ours", "10.0.0.1:5000", "10.0.0.3, 10.0.0.2", named, "10.0.0.1"},
		{"garbage next to the client", "10.0.0.1:5000", "foo, 203.0.113.9", named, "203.0.113.9"},
		{"garbage where the client should be", "10.0.0.1:5000", "203.0.113.9, foo", named, "10.0.0.1"},
		{"empty entry", "10.0.0.1:5000", "203.0.113.9, ", named, "10.0.0.1"},
		{"cloudflare in front of nginx", "10.0.0.1:5000", "203.0.113.9, 2400:cb00::1, 10.0.0.2", named, "203.0.113.9"},
		{"ipv6 client", "10.0.0.1:5000", "2001:db8::5, 10.0.0.2", named, "2001:db8::5"},
		{"v4-mapped client keys as v4", "10.0.0.1:5000", "::ffff:203.0.113.9", named, "203.0.113.9"},
		{"v4-mapped proxy hop is still ours", "10.0.0.1:5000", "203.0.113.9, ::ffff:10.0.0.2", named, "203.0.113.9"},
		{"hop carrying a port", "10.0.0.1:5000", "203.0.113.9:41234", named, "203.0.113.9"},
		{"ipv6 peer, no header", "[2001:db8::1]:80", "", named, "2001:db8::1"},
		{"unparseable peer is used as-is", "weird", "", named, "weird"},
		{"proxy adds a second header line", "10.0.0.1:5000", "1.2.3.4\n203.0.113.9", named, "203.0.113.9"},
		{"second line carries the chain", "10.0.0.1:5000", "1.2.3.4\n203.0.113.9, 10.0.0.2", named, "203.0.113.9"},

		// STOOP_TRUST_PROXY=true: every hop is trusted, so the walk would
		// skip the lot. The last entry is the one the proxy appended.
		{"trust everyone takes the rightmost", "10.0.0.1:5000", "1.2.3.4, 203.0.113.9", everyone, "203.0.113.9"},
		{"trust everyone, single hop", "8.8.8.8:5000", "203.0.113.9", everyone, "203.0.113.9"},
		{"trust everyone, no header", "8.8.8.8:5000", "", everyone, "8.8.8.8"},
		{"trust everyone, garbage last", "10.0.0.1:5000", "203.0.113.9, foo", everyone, "10.0.0.1"},
		{"trust everyone, second header line", "10.0.0.1:5000", "1.2.3.4\n203.0.113.9", everyone, "203.0.113.9"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// A newline separates repeated header lines.
			h := http.Header{}
			for _, line := range strings.Split(c.xff, "\n") {
				if line != "" {
					h.Add("X-Forwarded-For", line)
				}
			}
			if got := ClientIP(c.peer, h, c.trusts); got != c.want {
				t.Errorf("ClientIP(%q, %q) = %q, want %q", c.peer, c.xff, got, c.want)
			}
		})
	}
}

// A nil header is what a Connect peer without metadata looks like.
func TestClientIPNilHeader(t *testing.T) {
	if got := ClientIP("[::1]:80", nil, trustedproxy.All().Trusted); got != "::1" {
		t.Errorf("got %q, want ::1", got)
	}
}
