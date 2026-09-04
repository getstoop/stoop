package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Jhut89/stoop/internal/authctx"
)

func TestSecureTransport(t *testing.T) {
	probe := func(trustProxy bool, forwarded string) bool {
		var got bool
		h := secureTransport(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			got = authctx.SecureTransport(r.Context())
		}), func(string) bool { return trustProxy })
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		if forwarded != "" {
			req.Header.Set("X-Forwarded-Proto", forwarded)
		}
		h.ServeHTTP(httptest.NewRecorder(), req)
		return got
	}
	if probe(false, "") {
		t.Error("plain request must not be secure")
	}
	if probe(false, "https") {
		t.Error("X-Forwarded-Proto must be ignored unless the proxy is trusted")
	}
	if !probe(true, "HTTPS") {
		t.Error("trusted proxy's X-Forwarded-Proto: https must be secure")
	}
	if probe(true, "http") {
		t.Error("trusted proxy's X-Forwarded-Proto: http must not be secure")
	}
}

func TestSecurityHeaders(t *testing.T) {
	serve := func(secure bool, host string) http.Header {
		h := securityHeaders(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}),
			[]string{"'sha256-abc'"})
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Host = host
		if secure {
			req = req.WithContext(authctx.WithSecureTransport(req.Context(), true))
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Result().Header
	}

	got := serve(false, "stoop.example.com")
	if got.Get("Strict-Transport-Security") != "" {
		t.Error("HSTS must not be promised over plain HTTP")
	}
	for header, want := range map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "strict-origin-when-cross-origin",
	} {
		if got.Get(header) != want {
			t.Errorf("%s = %q, want %q", header, got.Get(header), want)
		}
	}
	csp := got.Get("Content-Security-Policy")
	for _, want := range []string{
		"default-src 'self'", "frame-ancestors 'none'", "object-src 'none'",
		"script-src 'self' 'sha256-abc'",
		"connect-src 'self' ws://stoop.example.com wss://stoop.example.com",
	} {
		if !strings.Contains(csp, want) {
			t.Errorf("CSP %q is missing %q", csp, want)
		}
	}
	if strings.Contains(csp, "script-src 'self' 'sha256-abc' 'unsafe-inline'") {
		t.Error("script-src must not fall back to 'unsafe-inline'")
	}

	if hsts := serve(true, "stoop.example.com").Get("Strict-Transport-Security"); hsts != hstsMaxAge {
		t.Errorf("HSTS over TLS = %q, want %q", hsts, hstsMaxAge)
	}

	// A Host that could carry the header somewhere else is dropped rather
	// than echoed; the policy still allows the same origin.
	csp = serve(false, "evil.example.com; script-src *").Get("Content-Security-Policy")
	if strings.Contains(csp, "evil.example.com") {
		t.Errorf("a malformed Host must not reach the policy: %q", csp)
	}
	if !strings.Contains(csp, "connect-src 'self';") {
		t.Errorf("connect-src should fall back to 'self': %q", csp)
	}
}
