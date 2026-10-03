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

type retryError struct {
	err   error
	after time.Duration
}

func (e *retryError) Error() string { return e.err.Error() }
func (e *retryError) Unwrap() error { return e.err }

type discardError struct{ err error }

func (e *discardError) Error() string { return e.err.Error() }
func (e *discardError) Unwrap() error { return e.err }

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
