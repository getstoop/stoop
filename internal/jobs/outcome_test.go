package jobs

import (
	"context"
	"errors"
	"sync/atomic"
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
	var seen atomic.Value
	Register(registry, "hands-back", func(_ context.Context, job *Job, _ NoArgs) error {
		seen.Store([2]int{job.Attempt, job.MaxAttempts})
		return NotAttempted(boom)
	}, Options{MaxAttempts: 1})
	id := mustEnqueue(t, service, "hands-back", nil)
	startDispatcher(t, service)

	// Past the kind's one attempt, still queued: each hand-back raises the
	// row's limit, attempt keeps counting leases, the performer sees its
	// one real try, and the wait grows with the job's age.
	for round, age := range []time.Duration{0, 6 * time.Second, 12 * time.Second} {
		lease := int32(round + 1)
		row := waitForState(t, pool, id, StateQueued, int(lease))
		if row.MaxAttempts != lease+1 || row.Error != "lookup failed" {
			t.Fatalf("round %d: max_attempts %d error %q", round, row.MaxAttempts, row.Error)
		}
		if got := seen.Load().([2]int); got != [2]int{1, 1} {
			t.Errorf("round %d: the performer saw attempt %d of %d", round, got[0], got[1])
		}
		if want := clock.Now().Add(max(age, 5*time.Second)); !row.NotBefore.Equal(want) {
			t.Errorf("round %d: not_before = %v, want %v", round, row.NotBefore, want)
		}
		clock.Advance(6 * time.Second)
	}

	// Past the window a hand-back counts, so the job ends.
	clock.Advance(handBackWindow)
	if row := waitForState(t, pool, id, StateDiscarded, 4); row.MaxAttempts != 4 {
		t.Errorf("discarded with max_attempts %d", row.MaxAttempts)
	}
}

// A lease that lapsed under a slow performer, then a hand-back by the
// dispatcher that took the row over: the slow performer's late outcome
// must not land.
func TestALateOutcomeCannotOverwriteAHandBack(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	release := make(chan struct{})
	var calls atomic.Int32
	perform := func(context.Context, *Job, NoArgs) error {
		if calls.Add(1) == 1 {
			<-release
			return nil
		}
		return NotAttempted(errors.New("lookup failed"))
	}
	first, firstRegistry := newTestService(pool, clock, testConfig())
	second, secondRegistry := newTestService(pool, clock, testConfig())
	Register(firstRegistry, "slow", perform, Options{})
	Register(secondRegistry, "slow", perform, Options{})
	id := mustEnqueue(t, first, "slow", nil)
	startDispatcher(t, first)
	waitForState(t, pool, id, StateRunning, 1)

	clock.Advance(first.lease + time.Second)
	startDispatcher(t, second)
	waitFor(t, "the hand-back", func() bool { return calls.Load() == 2 && readJob(t, pool, id).State == string(StateQueued) })

	close(release)
	// Asserting that a write did not happen: wait, don't poll.
	time.Sleep(10 * testConfig().Poll)
	if row := readJob(t, pool, id); row.State != string(StateQueued) || row.Attempt != 2 || row.Error != "lookup failed" {
		t.Errorf("the late outcome landed: state %s attempt %d error %q", row.State, row.Attempt, row.Error)
	}
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
