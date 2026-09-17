package instance

import (
	"encoding/base64"
	"testing"
)

func TestParseTunnelToken(t *testing.T) {
	token := base64.StdEncoding.EncodeToString([]byte(`{"a":"account","t":"tunnel","s":"secret"}`))
	unpadded := base64.RawStdEncoding.EncodeToString([]byte(`{"a":"account","t":"tunnel","s":"secret!"}`))
	cases := []struct {
		name, pasted, want string
		bad                bool
	}{
		{"blank keeps the saved one", "  ", "", false},
		{"the token", token, token, false},
		{"unpadded", unpadded, unpadded, false},
		{"the install command", "sudo cloudflared service install " + token + "\n", token, false},
		{"the run command", "cloudflared tunnel run --token " + token, token, false},
		{"not base64", "hunter2", "", true},
		{"not a token", base64.StdEncoding.EncodeToString([]byte(`{"a":"account"}`)), "", true},
	}
	for _, tc := range cases {
		got, err := ParseTunnelToken(tc.pasted)
		if got != tc.want || (err != nil) != tc.bad {
			t.Errorf("%s: got %q, %v", tc.name, got, err)
		}
	}
}
