package instance

import (
	"context"
	"sync"
	"time"
)

// The Health panel's port. A check is registered from internal/app, the
// only package that sees every dependency, and answers with a state and
// one line. Thresholds live in the check; the client draws the state it
// is given. See docs/architecture/diagnostics.md.

type CheckState int

const (
	CheckOK CheckState = iota
	CheckWarn
	CheckDanger
	// CheckOff is a dependency that is not configured: drawn muted, never
	// a warning.
	CheckOff
)

// HealthCheck is one row on the panel. Run gets a context that expires
// after healthTimeout; a probe that ignores it is reported as timed out.
type HealthCheck struct {
	Name string
	// FixTab is the admin tab that changes the setting: "hosting",
	// "storage", "integrations" or empty.
	FixTab string
	Run    func(ctx context.Context) (CheckState, string)
}

// Check is a row as last evaluated.
type Check struct {
	Name      string
	State     CheckState
	Detail    string
	FixTab    string
	CheckedAt time.Time
}

const (
	healthTTL     = 2 * time.Second
	healthTimeout = 3 * time.Second
)

type cachedCheck struct {
	check HealthCheck
	mu    sync.Mutex
	last  Check
}

// UseHealthChecks registers the checks, in the order the panel lists them.
func (s *Service) UseHealthChecks(checks ...HealthCheck) {
	for _, c := range checks {
		s.health = append(s.health, &cachedCheck{check: c})
	}
}

// UseStartedAt records when the process came up, for the uptime line.
func (s *Service) UseStartedAt(t time.Time) { s.startedAt = t }

// HealthSnapshot is the checks as GetHealth would report them, for
// GET /metrics; it shares the same cache.
func (s *Service) HealthSnapshot(ctx context.Context) []Check { return s.runHealthChecks(ctx) }

// runHealthChecks evaluates every check concurrently, each answer cached
// for healthTTL so a polling page does not hammer a dependency.
func (s *Service) runHealthChecks(ctx context.Context) []Check {
	out := make([]Check, len(s.health))
	var wg sync.WaitGroup
	for i, c := range s.health {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out[i] = c.result(ctx)
		}()
	}
	wg.Wait()
	return out
}

func (c *cachedCheck) result(ctx context.Context) Check {
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Since(c.last.CheckedAt) < healthTTL {
		return c.last
	}
	state, detail := c.run(ctx)
	c.last = Check{
		Name: c.check.Name, State: state, Detail: detail,
		FixTab: c.check.FixTab, CheckedAt: time.Now(),
	}
	return c.last
}

// run bounds the probe: the deadline is on the context, and a probe that
// does not honour it is abandoned rather than waited for.
func (c *cachedCheck) run(ctx context.Context) (CheckState, string) {
	ctx, cancel := context.WithTimeout(ctx, healthTimeout)
	defer cancel()
	type answer struct {
		state  CheckState
		detail string
	}
	done := make(chan answer, 1)
	go func() {
		st, d := c.check.Run(ctx)
		done <- answer{st, d}
	}()
	select {
	case a := <-done:
		return a.state, a.detail
	case <-ctx.Done():
		return CheckDanger, "no answer in " + healthTimeout.String()
	}
}
