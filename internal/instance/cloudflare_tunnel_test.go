package instance

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestParseTunnelToken(t *testing.T) {
	// The shape cloudflared decodes: a UUID tunnel id and a base64 secret.
	body := `{"a":"0123456789abcdef0123456789abcdef","t":"11111111-2222-3333-4444-555555555555","s":"c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0"}`
	token := base64.StdEncoding.EncodeToString([]byte(body))
	// Padded to a length base64 must pad, so the unpadded form differs.
	padded := body + strings.Repeat(" ", (4-len(body)%3)%3+1)
	cases := []struct {
		name, pasted, want string
		bad                bool
	}{
		{"blank keeps the saved one", "  ", "", false},
		{"the token", token, token, false},
		{"the install command", "sudo cloudflared service install " + token + "\n", token, false},
		{"the run command", "cloudflared tunnel run --token " + token, token, false},
		{"not base64", "hunter2", "", true},
		{"unpadded", base64.RawStdEncoding.EncodeToString([]byte(padded)), "", true},
		{"missing fields", base64.StdEncoding.EncodeToString([]byte(`{"a":"account"}`)), "", true},
		{"tunnel id not a uuid", base64.StdEncoding.EncodeToString([]byte(`{"a":"account","t":"tunnel","s":"c2VjcmV0"}`)), "", true},
		{"secret not base64", base64.StdEncoding.EncodeToString([]byte(`{"a":"account","t":"11111111-2222-3333-4444-555555555555","s":"secret!"}`)), "", true},
	}
	for _, tc := range cases {
		got, err := ParseTunnelToken(tc.pasted)
		if got != tc.want || (err != nil) != tc.bad {
			t.Errorf("%s: got %q, %v", tc.name, got, err)
		}
	}
}
