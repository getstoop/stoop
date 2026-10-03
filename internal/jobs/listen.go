package jobs

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	listenBackoffMin = time.Second
	listenBackoffMax = 30 * time.Second
	// listenSteady is how long a connection must have held for the next
	// failure to start the backoff over.
	listenSteady = time.Minute
	closeTimeout = time.Second
)

// listen holds one connection outside the pool on NotifyChannel and
// sends on wake for each notification, reconnecting with backoff after
// any failure, until ctx ends.
func (s *Service) listen(ctx context.Context, wake chan<- struct{}) {
	backoff := listenBackoffMin
	lastErr := ""
	for ctx.Err() == nil {
		started := time.Now()
		err := s.listenOnce(ctx, wake)
		if ctx.Err() != nil {
			return
		}
		// The same failure every retry is said once.
		level := slog.LevelWarn
		if err.Error() == lastErr {
			level = slog.LevelDebug
		} else {
			lastErr = err.Error()
		}
		s.log.Log(ctx, level, "jobs: listener stopped; retrying", "err", err, "in", backoff)
		if time.Since(started) > listenSteady {
			backoff = listenBackoffMin
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, listenBackoffMax)
	}
}

// listenOnce connects, listens and forwards notifications until the
// connection fails or ctx ends; the connection is closed either way.
func (s *Service) listenOnce(ctx context.Context, wake chan<- struct{}) error {
	conn, err := pgx.ConnectConfig(ctx, s.pool.Config().ConnConfig.Copy())
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), closeTimeout)
		defer cancel()
		_ = conn.Close(closeCtx)
	}()
	if _, err := conn.Exec(ctx, "LISTEN "+pgx.Identifier{NotifyChannel}.Sanitize()); err != nil {
		return err
	}
	if s.listening != nil {
		s.listening()
	}
	for {
		if _, err := conn.WaitForNotification(ctx); err != nil {
			return err
		}
		select {
		case wake <- struct{}{}:
		default:
		}
	}
}
