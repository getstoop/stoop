// Package ratelimit throttles anonymous traffic: per-client token buckets
// for the endpoints anyone on the internet can hit (login, registration,
// the LiveKit signaling proxy). It is deliberately in-memory and
// per-process — a homelab server has one process, and a limiter that
// needs Redis would never be turned on.
package ratelimit

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Limiter holds one token bucket per key (normally a client IP). Buckets
// idle for longer than the refill horizon are dropped, so memory stays
// proportional to recent distinct clients rather than to history.
type Limiter struct {
	perMinute int
	burst     int

	mu      sync.Mutex
	buckets map[string]*bucket
	lastGC  time.Time
	now     func() time.Time
}

type bucket struct {
	lim  *rate.Limiter
	seen time.Time
}

// maxBuckets bounds the map under a flood of spoofed addresses. When full,
// new keys are still limited — they share one overflow bucket rather than
// being waved through.
const maxBuckets = 100_000

// New builds a limiter allowing perMinute sustained requests per key with
// the given burst. perMinute <= 0 disables limiting: Allow always returns
// true. That is the dev/e2e setting, not a production one.
func New(perMinute, burst int) *Limiter {
	if burst < 1 {
		burst = 1
	}
	return &Limiter{
		perMinute: perMinute,
		burst:     burst,
		buckets:   make(map[string]*bucket),
		now:       time.Now,
	}
}

// Enabled reports whether the limiter throttles anything.
func (l *Limiter) Enabled() bool { return l != nil && l.perMinute > 0 }

// Allow consumes one token for key and reports whether it was available.
func (l *Limiter) Allow(key string) bool {
	if !l.Enabled() {
		return true
	}
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	l.gcLocked(now)
	b, ok := l.buckets[key]
	if !ok {
		if len(l.buckets) >= maxBuckets {
			key = "" // overflow bucket
			if b, ok = l.buckets[key]; !ok {
				b = l.newBucket()
				l.buckets[key] = b
			}
		} else {
			b = l.newBucket()
			l.buckets[key] = b
		}
	}
	b.seen = now
	return b.lim.AllowN(now, 1)
}

func (l *Limiter) newBucket() *bucket {
	return &bucket{lim: rate.NewLimiter(rate.Limit(float64(l.perMinute)/60), l.burst)}
}

// gcLocked drops buckets that have refilled completely since they were
// last touched — they'd behave exactly like a fresh bucket anyway.
func (l *Limiter) gcLocked(now time.Time) {
	const every = time.Minute
	if now.Sub(l.lastGC) < every {
		return
	}
	l.lastGC = now
	refill := time.Duration(float64(l.burst)/float64(l.perMinute)*60) * time.Second
	for k, b := range l.buckets {
		if now.Sub(b.seen) > refill {
			delete(l.buckets, k)
		}
	}
}

// RetryAfter is the hint sent to throttled clients. Buckets refill
// continuously so the true wait is under a minute; one round number keeps
// the header honest without leaking bucket state.
const RetryAfter = 60 * time.Second
