package ratelimit

import (
	"net/http"
	"strconv"
)

// Middleware rejects requests over the limit with 429 before next runs.
// trusts answers "may this peer's forwarded headers be believed?" per
// request, so the operator can change the trusted proxies without a
// restart.
func Middleware(l *Limiter, trusts func(remoteAddr string) bool, next http.Handler) http.Handler {
	if !l.Enabled() {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !l.Allow(ClientIP(r.RemoteAddr, r.Header, trusts)) {
			w.Header().Set("Retry-After", strconv.Itoa(int(RetryAfter.Seconds())))
			http.Error(w, "too many requests; slow down", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}
