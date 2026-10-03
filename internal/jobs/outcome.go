package jobs

import "time"

// RetryIn marks err as a failure to retry after a chosen wait instead of
// the kind's backoff. MaxAttempts still applies.
func RetryIn(err error, after time.Duration) error { panic("jobs: not built") }

// Discard marks err as a failure that is never retried.
func Discard(err error) error { panic("jobs: not built") }
