package auth

import (
	"sync"
	"time"
)

// loginGuard slows password guessing against one account regardless of
// where the guesses come from — the per-IP limiter can't see a botnet.
// After lockoutThreshold consecutive failures the username is refused for
// a delay that doubles per further failure, up to lockoutMax; a correct
// password clears it. The key is whatever the caller typed, existing
// account or not, so the response never says which usernames are real.
//
// State is in-memory and bounded: entries idle for lockoutIdle are
// pruned, and the map never exceeds lockoutMaxEntries.
type loginGuard struct {
	mu      sync.Mutex
	entries map[string]*loginEntry
	lastGC  time.Time
	now     func() time.Time
}

type loginEntry struct {
	failures    int
	lockedUntil time.Time
	seen        time.Time
}

const (
	lockoutThreshold  = 5
	lockoutBase       = 30 * time.Second
	lockoutMax        = 15 * time.Minute
	lockoutIdle       = time.Hour
	lockoutMaxEntries = 50_000
)

func newLoginGuard() *loginGuard {
	return &loginGuard{entries: make(map[string]*loginEntry), now: time.Now}
}

// check returns how long the username is still locked out; zero means
// the attempt may proceed.
func (g *loginGuard) check(username string) time.Duration {
	now := g.now()
	g.mu.Lock()
	defer g.mu.Unlock()
	e, ok := g.entries[username]
	if !ok || now.After(e.lockedUntil) {
		return 0
	}
	return e.lockedUntil.Sub(now)
}

// failure records a wrong password (or unknown user) for username.
func (g *loginGuard) failure(username string) {
	now := g.now()
	g.mu.Lock()
	defer g.mu.Unlock()
	g.gcLocked(now)
	e, ok := g.entries[username]
	if !ok {
		if len(g.entries) >= lockoutMaxEntries {
			// Full even after GC: drop the stalest entry rather than the
			// new one, so an attacker's fresh targets are still tracked.
			g.evictOldestLocked()
		}
		e = &loginEntry{}
		g.entries[username] = e
	}
	e.failures++
	e.seen = now
	if e.failures >= lockoutThreshold {
		delay := lockoutBase << (e.failures - lockoutThreshold)
		if delay > lockoutMax || delay <= 0 {
			delay = lockoutMax
		}
		e.lockedUntil = now.Add(delay)
	}
}

// success clears username's failure history.
func (g *loginGuard) success(username string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.entries, username)
}

func (g *loginGuard) gcLocked(now time.Time) {
	if now.Sub(g.lastGC) < time.Minute {
		return
	}
	g.lastGC = now
	for k, e := range g.entries {
		if now.Sub(e.seen) > lockoutIdle && now.After(e.lockedUntil) {
			delete(g.entries, k)
		}
	}
}

func (g *loginGuard) evictOldestLocked() {
	var oldestKey string
	var oldest time.Time
	first := true
	for k, e := range g.entries {
		if first || e.seen.Before(oldest) {
			oldestKey, oldest, first = k, e.seen, false
		}
	}
	delete(g.entries, oldestKey)
}
