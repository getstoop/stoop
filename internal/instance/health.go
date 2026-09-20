package instance

import (
	"context"
	"sync"
	"time"
)

// The Health panel's port. A check is registered from internal/app, the
// only package that sees every dependency, and answers with a state and
// one line. Thresholds live in the check; the client draws the state it
// is given. See docs/proposals/diagnostics.md.

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
	check   HealthCheck
	timeout time.Duration
	mu      sync.Mutex
	last    Check
}

// UseHealthChecks registers the checks, in the order the panel lists them.
func (s *Service) UseHealthChecks(checks ...HealthCheck) {
	for _, c := range checks {
		s.health = append(s.health, &cachedCheck{check: c, timeout: healthTimeout})
	}
}

// UseStartedAt records when the process came up, for the uptime line.
func (s *Service) UseStartedAt(t time.Time) { s.startedAt = t }

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
	state, detail, settled := c.run(ctx)
	got := Check{
		Name: c.check.Name, State: state, Detail: detail,
		FixTab: c.check.FixTab, CheckedAt: time.Now(),
	}
	if settled {
		c.last = got
	}
	return got
}

// run bounds the probe: the deadline is on the probe's context, and a
// probe that does not honour it is abandoned rather than waited for. The
// caller leaving (a closed tab) does not cut the probe short, and its
// answer is not settled, so a false failure is never cached.
func (c *cachedCheck) run(ctx context.Context) (state CheckState, detail string, settled bool) {
	probe, cancel := context.WithTimeout(context.WithoutCancel(ctx), c.timeout)
	type answer struct {
		state  CheckState
		detail string
	}
	done := make(chan answer, 1)
	go func() {
		st, d := c.check.Run(probe)
		done <- answer{st, d}
		cancel()
	}()
	select {
	case a := <-done:
		return a.state, a.detail, true
	case <-probe.Done():
		// The answer is sent before cancel, so an empty channel here is
		// the deadline, not a finished probe.
		select {
		case a := <-done:
			return a.state, a.detail, true
		default:
			return CheckDanger, "no answer in " + c.timeout.String(), true
		}
	case <-ctx.Done():
		return CheckDanger, "request ended before the check answered", false
	}
}
