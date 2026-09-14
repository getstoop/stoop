package netguard

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestPolicyAllows(t *testing.T) {
	cases := []struct {
		ip                     string
		public, private, never bool
	}{
		{"8.8.8.8", true, false, false}, {"2606:4700::1111", true, false, false},
		{"127.0.0.1", false, true, false}, {"::1", false, true, false},
		{"10.1.2.3", false, true, false}, {"192.168.2.134", false, true, false}, {"172.16.5.5", false, true, false},
		{"100.65.98.12", false, true, false}, {"fd00::1", false, true, false}, {"::ffff:10.0.0.1", false, true, false},
		{"169.254.169.254", false, false, true}, {"169.254.1.1", false, false, true}, {"fe80::1", false, false, true},
		{"224.0.0.1", false, false, true}, {"0.0.0.0", false, false, true},
	}
	closed, open := Policy{}, Policy{AllowPrivate: true}
	for _, c := range cases {
		ip := netip.MustParseAddr(c.ip)
		if IsPublic(ip) != c.public {
			t.Errorf("IsPublic(%s) = %v", c.ip, !c.public)
		}
		if got := closed.Allows(ip); got != c.public {
			t.Errorf("default policy allows %s = %v", c.ip, got)
		}
		if got := open.Allows(ip); got != (c.public || c.private) {
			t.Errorf("private-targets policy allows %s = %v", c.ip, got)
		}
		if c.never && open.Allows(ip) {
			t.Errorf("%s must never be reachable", c.ip)
		}
	}
}

func TestCheckURL(t *testing.T) {
	for raw, ok := range map[string]bool{
		"https://example.com/hook": true, "http://10.0.0.1:8080/x": true,
		"ftp://example.com/x": false, "https://user:pw@example.com/": false, "https:///path": false, "file:///etc/passwd": false,
	} {
		u, _ := url.Parse(raw)
		if err := CheckURL(u); (err == nil) != ok {
			t.Errorf("CheckURL(%s) = %v", raw, err)
		}
	}
}

func TestTransportHonoursThePolicy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	defer srv.Close()
	open := &http.Client{Transport: Policy{AllowPrivate: true}.Transport(), Timeout: 5 * time.Second}
	res, err := open.Post(srv.URL, "text/plain", strings.NewReader("x"))
	if err != nil || res.StatusCode != http.StatusNoContent {
		t.Fatalf("loopback under the private policy: %v %v", err, res)
	}
	closed := &http.Client{Transport: Policy{}.Transport(), Timeout: 5 * time.Second}
	if _, err := closed.Post(srv.URL, "text/plain", strings.NewReader("x")); !errors.Is(err, ErrNotPublic) {
		t.Errorf("loopback under the default policy: %v", err)
	}
}
