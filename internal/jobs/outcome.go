package jobs

import (
	"errors"
	"time"
)

// RetryIn marks err as a failure to retry after a chosen wait instead of
// the kind's backoff. MaxAttempts still applies.
func RetryIn(err error, after time.Duration) error {
	return &retryError{err: err, after: after}
}

// Discard marks err as a failure that is never retried.
func Discard(err error) error { return &discardError{err: err} }

// NotAttempted marks err as a failure before the job did any of its work,
// so the attempt is given back. See docs/architecture/runtime.md →
// Background work for the wait and the limit.
func NotAttempted(err error) error { return &notAttemptedError{err: err} }

// handBackWindow is how long after its creation a job may be handed back;
// past it, a NotAttempted failure counts as an attempt.
const handBackWindow = time.Hour

type retryError struct {
	err   error
	after time.Duration
}

func (e *retryError) Error() string { return e.err.Error() }
func (e *retryError) Unwrap() error { return e.err }

type discardError struct{ err error }

func (e *discardError) Error() string { return e.err.Error() }
func (e *discardError) Unwrap() error { return e.err }

type notAttemptedError struct{ err error }

func (e *notAttemptedError) Error() string { return e.err.Error() }
func (e *notAttemptedError) Unwrap() error { return e.err }

// handBack reports whether a failed attempt is given back rather than
// counted.
func handBack(err error, age time.Duration) bool {
	var notAttempted *notAttemptedError
	return errors.As(err, &notAttempted) && !isDiscard(err) && age < handBackWindow
}

// handBackWait grows with the job's age, within the kind's ladder.
func handBackWait(age time.Duration, backoff []time.Duration) time.Duration {
	return min(max(age, backoff[0]), backoff[len(backoff)-1])
}

func isDiscard(err error) bool {
	var discard *discardError
	return errors.As(err, &discard)
}

// retryWait is how long a failed attempt waits before the next: the
// RetryIn wait when the error carries one, else the kind's ladder with
// the last step repeating.
func retryWait(err error, attempt int, backoff []time.Duration) time.Duration {
	var retry *retryError
	if errors.As(err, &retry) {
		return retry.after
	}
	step := min(max(attempt-1, 0), len(backoff)-1)
	return backoff[step]
}
