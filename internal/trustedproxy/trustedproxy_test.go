package trustedproxy_test

import (
	"testing"

	"github.com/getstoop/stoop/internal/trustedproxy"
)

func TestParseAndTrust(t *testing.T) {
	set, err := trustedproxy.Parse([]string{"10.0.0.0/8", " 192.168.1.5 ", "", "fd00::/8"})
	if err != nil {
		t.Fatal(err)
	}
	if got := set.Strings(); len(got) != 3 || got[0] != "10.0.0.0/8" || got[1] != "192.168.1.5" || got[2] != "fd00::/8" {
		t.Fatalf("round trip: %v", got)
	}
	cases := map[string]bool{
		"10.4.5.6:5555":         true,  // inside the range
		"192.168.1.5:80":        true,  // the single address
		"192.168.1.6:80":        false, // its neighbour is not
		"11.0.0.1:80":           false,
		"[fd00::1]:443":         true,
		"[::ffff:10.1.2.3]:443": true, // v4-mapped peer
		"10.9.9.9":              true, // no port
		"not-an-address":        false,
		"":                      false,
	}
	for addr, want := range cases {
		if got := set.Trusted(addr); got != want {
			t.Errorf("Trusted(%q) = %v, want %v", addr, got, want)
		}
	}
	if set.Empty() {
		t.Error("set with prefixes reports empty")
	}
}

func TestZeroValueTrustsNothing(t *testing.T) {
	var none trustedproxy.Set
	if !none.Empty() {
		t.Error("zero value should be empty")
	}
	for _, addr := range []string{"10.0.0.1:80", "127.0.0.1:80", "8.8.8.8:80"} {
		if none.Trusted(addr) {
			t.Errorf("zero value trusted %q", addr)
		}
	}
}

func TestAllTrustsEveryone(t *testing.T) {
	all := trustedproxy.All()
	if all.Empty() {
		t.Error("All() reports empty")
	}
	if !all.Trusted("8.8.8.8:80") || !all.Trusted("garbage") {
		t.Error("All() should trust any peer")
	}
}

func TestParseRejectsJunk(t *testing.T) {
	for _, bad := range []string{"example.com", "10.0.0.0/64", "1.2.3.4/x", "hello"} {
		if _, err := trustedproxy.Parse([]string{bad}); err == nil {
			t.Errorf("Parse(%q) accepted it", bad)
		}
	}
}
