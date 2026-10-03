package auth

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"connectrpc.com/connect"

	"github.com/getstoop/stoop/internal/kv"
)

// loginGuard slows password guessing against one account regardless of
// where the guesses come from — the per-IP limiter can't see a botnet.
// After lockoutThreshold consecutive failures the username is refused for
// a delay that doubles per further failure, up to lockoutMax; a correct
// password clears it. The key is whatever the caller typed, existing
// account or not, so the response never says which usernames are real.
//
// State is a kv store: an entry goes after lockoutIdle without a failure,
// and the store never holds more than lockoutMaxEntries.
type loginGuard struct {
	entries kv.Store[loginEntry]
	now     func() time.Time
}

type loginEntry struct {
	failures    int
	lockedUntil time.Time
}

const (
	lockoutThreshold  = 5
	lockoutBase       = 30 * time.Second
	lockoutMax        = 15 * time.Minute
	lockoutIdle       = time.Hour
	lockoutMaxEntries = 50_000
)

func newLoginGuard(backend kv.Backend) *loginGuard {
	return &loginGuard{
		entries: kv.Open[loginEntry](backend, "lockouts", lockoutMaxEntries),
		now:     time.Now,
	}
}

// check returns how long the username is still locked out; zero means
// the attempt may proceed.
func (g *loginGuard) check(ctx context.Context, username string) (time.Duration, error) {
	entry, found, err := g.entries.Get(ctx, username)
	if err != nil || !found {
		return 0, err
	}
	now := g.now()
	if now.After(entry.lockedUntil) {
		return 0, nil
	}
	return entry.lockedUntil.Sub(now), nil
}

// failure records a wrong password (or unknown user) for username.
func (g *loginGuard) failure(ctx context.Context, username string) error {
	now := g.now()
	return g.entries.Update(ctx, username, func(entry loginEntry, _ bool) (loginEntry, time.Duration, bool) {
		entry.failures++
		if entry.failures >= lockoutThreshold {
			delay := lockoutBase << (entry.failures - lockoutThreshold)
			if delay > lockoutMax || delay <= 0 {
				delay = lockoutMax
			}
			entry.lockedUntil = now.Add(delay)
		}
		return entry, lockoutIdle, true
	})
}

// success clears username's failure history.
func (g *loginGuard) success(ctx context.Context, username string) error {
	return g.entries.Delete(ctx, username)
}

// errGuardDown refuses a sign-in the guard could not account for. Letting
// it through would make a store outage a way past the lockout.
func errGuardDown(err error) error {
	slog.Error("login guard store", "err", err)
	return connect.NewError(connect.CodeUnavailable,
		errors.New("sign-in is unavailable right now; try again in a moment"))
}
