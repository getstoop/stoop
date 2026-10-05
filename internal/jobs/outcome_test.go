package jobs

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

func TestFailedAttemptsLandOnTheLadder(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	service, registry := newTestService(pool, clock, testConfig())
	boom := errors.New("boom")
	Register(registry, "fails", func(context.Context, *Job, NoArgs) error { return boom }, Options{})
	Register(registry, "retry-in", func(context.Context, *Job, NoArgs) error {
		return RetryIn(boom, 42*time.Second)
	}, Options{})
	Register(registry, "discards", func(context.Context, *Job, NoArgs) error { return Discard(boom) }, Options{})
	Register(registry, "exhausts", func(context.Context, *Job, NoArgs) error { return boom }, Options{MaxAttempts: 1})

	fails := mustEnqueue(t, service, "fails", nil)
	retryIn := mustEnqueue(t, service, "retry-in", nil)
	discards := mustEnqueue(t, service, "discards", nil)
	exhausts := mustEnqueue(t, service, "exhausts", nil)
	startDispatcher(t, service)

	row := waitForState(t, pool, fails, StateQueued, 1)
	if row.Error != "boom" || row.LeasedUntil != nil {
		t.Errorf("failed row: error %q leased_until %v", row.Error, row.LeasedUntil)
	}
	if !row.NotBefore.Equal(clock.Now().Add(5 * time.Second)) {
		t.Errorf("not_before = %v, want now + 5s", row.NotBefore)
	}
	sameInstant(t, "finished_at", row.FinishedAt, clock.Now())

	row = waitForState(t, pool, retryIn, StateQueued, 1)
	if !row.NotBefore.Equal(clock.Now().Add(42 * time.Second)) {
		t.Errorf("RetryIn not_before = %v, want now + 42s", row.NotBefore)
	}

	row = waitForState(t, pool, discards, StateDiscarded, 1)
	if row.Error != "boom" || row.FinishedAt == nil {
		t.Errorf("discarded row: error %q finished_at %v", row.Error, row.FinishedAt)
	}
	waitForState(t, pool, exhausts, StateDiscarded, 1)

	// The second failure waits the second step of the ladder.
	clock.Advance(6 * time.Second)
	row = waitForState(t, pool, fails, StateQueued, 2)
	if !row.NotBefore.Equal(clock.Now().Add(30 * time.Second)) {
		t.Errorf("second not_before = %v, want now + 30s", row.NotBefore)
	}
}

func TestRetryWaitRepeatsTheLastStep(t *testing.T) {
	ladder := []time.Duration{time.Second, time.Minute}
	for attempt, want := range map[int]time.Duration{1: time.Second, 2: time.Minute, 7: time.Minute} {
		if got := retryWait(errors.New("x"), attempt, ladder); got != want {
			t.Errorf("attempt %d: wait %v, want %v", attempt, got, want)
		}
	}
	if got := retryWait(RetryIn(errors.New("x"), 9*time.Second), 1, ladder); got != 9*time.Second {
		t.Errorf("RetryIn wait = %v", got)
	}
}

func TestWrappedErrorsStillMatch(t *testing.T) {
	base := errors.New("base")
	if !errors.Is(RetryIn(base, time.Second), base) || !errors.Is(Discard(base), base) {
		t.Error("errors.Is lost the original")
	}
	if !isDiscard(Discard(base)) || isDiscard(RetryIn(base, time.Second)) {
		t.Error("isDiscard mis-sorted")
	}
}

func TestNotAttemptedGivesTheAttemptBack(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	service, registry := newTestService(pool, clock, testConfig())
	boom := errors.New("lookup failed")
	Register(registry, "hands-back", func(context.Context, *Job, NoArgs) error { return NotAttempted(boom) }, Options{MaxAttempts: 1})
	id := mustEnqueue(t, service, "hands-back", nil)
	startDispatcher(t, service)

	// Past MaxAttempts, still queued: each hand-back returns the attempt,
	// and the wait grows with the job's age.
	for round, age := range []time.Duration{0, 6 * time.Second, 12 * time.Second} {
		row := waitForState(t, pool, id, StateQueued, 0)
		waitFor(t, "a hand-back", func() bool {
			row = readJob(t, pool, id)
			return row.StartedAt != nil && row.StartedAt.Equal(clock.Now()) && row.State == string(StateQueued)
		})
		if row.Attempt != 0 || row.Error != "lookup failed" {
			t.Fatalf("round %d: attempt %d error %q", round, row.Attempt, row.Error)
		}
		if want := clock.Now().Add(max(age, 5*time.Second)); !row.NotBefore.Equal(want) {
			t.Errorf("round %d: not_before = %v, want %v", round, row.NotBefore, want)
		}
		clock.Advance(6 * time.Second)
	}

	// Past the window a hand-back counts, so the job ends.
	clock.Advance(handBackWindow)
	waitForState(t, pool, id, StateDiscarded, 1)
}

func TestHandBackWaitStaysOnTheLadder(t *testing.T) {
	ladder := []time.Duration{5 * time.Second, 2 * time.Minute}
	for age, want := range map[time.Duration]time.Duration{0: 5 * time.Second, 40 * time.Second: 40 * time.Second, time.Hour: 2 * time.Minute} {
		if got := handBackWait(age, ladder); got != want {
			t.Errorf("age %v: wait %v, want %v", age, got, want)
		}
	}
	if handBack(Discard(NotAttempted(errors.New("x"))), 0) || !handBack(NotAttempted(errors.New("x")), 0) {
		t.Error("handBack mis-sorted")
	}
}
