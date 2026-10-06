package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/alexedwards/argon2id"
)

const (
	// defaultHashSlots is how many password hashes run at once. Each holds
	// the hash's memory (64 MiB by default) while it runs, so the slots,
	// not the callers, bound what sign-ins can cost (STOOP-402).
	defaultHashSlots = 4
	// hashWait is how long a hash queues for a slot before it is refused.
	hashWait = 5 * time.Second
)

var errHashBusy = connect.NewError(connect.CodeUnavailable,
	errors.New("the server is busy; try again in a moment"))

// hashPassword is argon2id.CreateHash in a hash slot.
func (s *Service) hashPassword(ctx context.Context, password string) (string, error) {
	release, err := s.takeHashSlot(ctx)
	if err != nil {
		return "", err
	}
	defer release()
	return argon2id.CreateHash(password, s.argon2)
}

// checkPassword is argon2id.ComparePasswordAndHash in a hash slot.
func (s *Service) checkPassword(ctx context.Context, password, hash string) (bool, error) {
	release, err := s.takeHashSlot(ctx)
	if err != nil {
		return false, err
	}
	defer release()
	return argon2id.ComparePasswordAndHash(password, hash)
}

// takeHashSlot waits for a free slot. A caller that has gone never gets
// one: select picks at random among ready cases, so cancellation is
// checked again once a slot is taken.
func (s *Service) takeHashSlot(ctx context.Context) (release func(), err error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	timer := time.NewTimer(s.hashWait)
	defer timer.Stop()
	select {
	case s.hashSlots <- struct{}{}:
		if err := ctx.Err(); err != nil {
			<-s.hashSlots
			return nil, err
		}
		return func() { <-s.hashSlots }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
		return nil, errHashBusy
	}
}

// hashFailure passes the busy refusal through as it is and wraps any
// other hashing error with what was being done.
func hashFailure(doing string, err error) error {
	if errors.Is(err, errHashBusy) {
		return err
	}
	return fmt.Errorf("%s: %w", doing, err)
}
