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
