package config

import "testing"

func TestURLRules(t *testing.T) {
	cases := []struct {
		raw                     string
		httpURL, origin, issuer bool
	}{
		{"https://chat.example.com", true, true, true},
		{"http://localhost:8080/", true, true, true},
		{"https://auth.example.com/realms/home", true, false, true},
		{"https://chat.example.com/?a=1", true, false, false},
		{"https://chat.example.com#top", true, false, false},
		{"https://auth.example.com/realms/home?x=1", true, false, false},
		{"https://", false, false, false},
		{"chat.example.com", false, false, false},
		{"ftp://chat.example.com", false, false, false},
		{"", false, false, false},
	}
	for _, tc := range cases {
		if _, got := HTTPURL(tc.raw); got != tc.httpURL {
			t.Errorf("HTTPURL(%q) = %v, want %v", tc.raw, got, tc.httpURL)
		}
		if got := Origin(tc.raw); got != tc.origin {
			t.Errorf("Origin(%q) = %v, want %v", tc.raw, got, tc.origin)
		}
		if got := IssuerURL(tc.raw); got != tc.issuer {
			t.Errorf("IssuerURL(%q) = %v, want %v", tc.raw, got, tc.issuer)
		}
	}
}

func TestValidProviderID(t *testing.T) {
	for id, want := range map[string]bool{
		"sso": true, "ab": true, "my-idp_2": true,
		"a": false, "Sso": false, "has space": false, "": false,
		"abcdefghijklmnopqrstuvwxyz0123456": false,
	} {
		if got := ValidProviderID(id); got != want {
			t.Errorf("ValidProviderID(%q) = %v, want %v", id, got, want)
		}
	}
}

func TestLoad_RefusesQueryAndFragment(t *testing.T) {
	t.Setenv("STOOP_DATABASE_URL", "postgres://x")
	t.Run("public url", func(t *testing.T) {
		for _, bad := range []string{"https://chat.example.com?a=1", "https://chat.example.com/#top"} {
			t.Setenv("STOOP_PUBLIC_URL", bad)
			if _, err := Load(); err == nil {
				t.Errorf("%q should be rejected", bad)
			}
		}
	})
	t.Run("oidc issuer", func(t *testing.T) {
		t.Setenv("STOOP_OIDC_CLIENT_ID", "client")
		t.Setenv("STOOP_OIDC_CLIENT_SECRET", "secret")
		for _, bad := range []string{"https://auth.example.com?a=1", "https://auth.example.com/#top"} {
			t.Setenv("STOOP_OIDC_ISSUER", bad)
			if _, err := Load(); err == nil {
				t.Errorf("%q should be rejected", bad)
			}
		}
	})
}
