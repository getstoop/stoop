package app

import (
	"net/http"
	"strings"

	"github.com/getstoop/stoop/internal/authctx"
)

// secureTransport tells handlers whether this request came in over TLS —
// directly, or as a trusted proxy reported it — so session cookies can be
// Secure per request. trusts is consulted per request, so the trusted
// proxies can change without a restart.
func secureTransport(next http.Handler, trusts func(remoteAddr string) bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		secure := r.TLS != nil ||
			(trusts(r.RemoteAddr) && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"))
		if secure {
			r = r.WithContext(authctx.WithSecureTransport(r.Context(), true))
		}
		next.ServeHTTP(w, r)
	})
}

const permissionsPolicy = "camera=(self), microphone=(self), display-capture=(self), " +
	"geolocation=(), payment=(), usb=(), serial=(), midi=()"

// A year, without includeSubDomains: Stoop is usually one name among
// several on the operator's domain.
const hstsMaxAge = "max-age=31536000"

// securityHeaders applies one policy to every response. scripts are the
// extra script-src sources index.html needs (webui.ScriptHashes).
//
// It sits inside secureTransport: HSTS is only promised when the request
// arrived over HTTPS. docs/self-hosting.md → Security headers.
func securityHeaders(next http.Handler, scripts []string) http.Handler {
	scriptSrc := strings.Join(append([]string{"'self'"}, scripts...), " ")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", contentSecurityPolicy(scriptSrc, r.Host))
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY") // frame-ancestors, pre-CSP
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Permissions-Policy", permissionsPolicy)
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		if authctx.SecureTransport(r.Context()) {
			h.Set("Strict-Transport-Security", hstsMaxAge)
		}
		next.ServeHTTP(w, r)
	})
}

// contentSecurityPolicy is the whole policy for one request. Everything
// the app loads it serves itself; each exception is listed in
// docs/self-hosting.md → Security headers.
func contentSecurityPolicy(scriptSrc, host string) string {
	// The gateway and the signaling proxy are websockets on this origin.
	// 'self' covers them in a current browser; older Safari needs the
	// origin named in the scheme the socket uses.
	connectSrc := "'self'"
	if h := wsHost(host); h != "" {
		connectSrc += " ws://" + h + " wss://" + h
	}
	return strings.Join([]string{
		"default-src 'self'",
		"base-uri 'self'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"form-action 'self'",
		"script-src " + scriptSrc,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"media-src 'self' blob:",
		"font-src 'self'",
		"connect-src " + connectSrc,
		"worker-src 'self' blob:",
		"manifest-src 'self'",
	}, "; ")
}

// wsHost returns the request's Host when it is safe to write into a
// header. It grants nothing new — it is the origin the browser already
// reached — but a stray space would let a caller append directives.
func wsHost(host string) string {
	if host == "" || len(host) > 255 {
		return ""
	}
	for _, c := range []byte(host) {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case c == '.' || c == '-' || c == ':' || c == '[' || c == ']':
		default:
			return ""
		}
	}
	return host
}
