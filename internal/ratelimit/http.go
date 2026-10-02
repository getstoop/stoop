package ratelimit

import (
	"log/slog"
	"net/http"
	"strconv"
)

// unavailableMessage is the refusal when the store cannot answer: the
// request is not waved through, since that would make an outage a way
// past the limit.
const unavailableMessage = "the server cannot take this request right now; try again in a moment"

// Middleware rejects requests over the limit with 429 before next runs.
// trusts answers "may this peer's forwarded headers be believed?" per
// request, so the operator can change the trusted proxies without a
// restart.
func Middleware(l *Limiter, trusts func(remoteAddr string) bool, next http.Handler) http.Handler {
	if !l.Enabled() {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		allowed, err := l.Allow(r.Context(), ClientIP(r.RemoteAddr, r.Header, trusts))
		if err != nil {
			slog.Error("rate limiter store", "err", err)
			http.Error(w, unavailableMessage, http.StatusServiceUnavailable)
			return
		}
		if !allowed {
			w.Header().Set("Retry-After", strconv.Itoa(int(RetryAfter.Seconds())))
			http.Error(w, "too many requests; slow down", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}
