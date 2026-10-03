// Package ratelimit throttles anonymous traffic: per-client token buckets
// for the endpoints anyone on the internet can hit (login, registration,
// the LiveKit signaling proxy). The buckets live in a kv store, in
// process: a homelab server has one, and a limiter that needed a second
// service would never be turned on.
package ratelimit

import (
	"context"
	"time"

	"github.com/getstoop/stoop/internal/kv"
)

// Limiter holds one token bucket per key (normally a client IP). A bucket
// expires once it would have refilled completely, so memory stays
// proportional to recent distinct clients rather than to history.
type Limiter struct {
	perMinute int
	burst     int
	buckets   kv.Store[bucket]
	now       func() time.Time
}

type bucket struct {
	tokens float64
	at     time.Time
}

// maxBuckets bounds the store under a flood of spoofed addresses. When
// full, the bucket nearest to refilling makes way for the new key.
const maxBuckets = 100_000

// New builds a limiter allowing perMinute sustained requests per key with
// the given burst, keeping its buckets in the backend's store called
// name. perMinute <= 0 disables limiting: Allow always returns true. That
// is the dev/e2e setting, not a production one.
func New(backend kv.Backend, name string, perMinute, burst int) *Limiter {
	if burst < 1 {
		burst = 1
	}
	return &Limiter{
		perMinute: perMinute,
		burst:     burst,
		buckets:   kv.Open[bucket](backend, name, maxBuckets),
		now:       time.Now,
	}
}

// Enabled reports whether the limiter throttles anything.
func (l *Limiter) Enabled() bool { return l != nil && l.perMinute > 0 }

// Allow consumes one token for key and reports whether it was available.
// An error means the store could not answer; callers refuse the request.
func (l *Limiter) Allow(ctx context.Context, key string) (bool, error) {
	if !l.Enabled() {
		return true, nil
	}
	perSecond := float64(l.perMinute) / 60
	refill := time.Duration(float64(l.burst) / perSecond * float64(time.Second))
	allowed := false
	err := l.buckets.Update(ctx, key, func(b bucket, found bool) (bucket, time.Duration, bool) {
		// The clock is read under the store's lock, so two requests for
		// one key see time move one way.
		now := l.now()
		if !found {
			b = bucket{tokens: float64(l.burst), at: now}
		}
		b.tokens = min(float64(l.burst), b.tokens+now.Sub(b.at).Seconds()*perSecond)
		b.at = now
		if b.tokens >= 1 {
			b.tokens--
			allowed = true
		}
		return b, refill, true
	})
	return allowed, err
}

// RetryAfter is the hint sent to throttled clients. Buckets refill
// continuously so the true wait is under a minute; one round number keeps
// the header honest without leaking bucket state.
const RetryAfter = 60 * time.Second
