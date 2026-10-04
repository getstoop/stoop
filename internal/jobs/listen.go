package jobs

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/restart"
)

const closeTimeout = time.Second

// listen holds one connection outside the pool on NotifyChannel and
// sends on wake for each notification, reconnecting with backoff after
// any failure, until ctx ends.
func (s *Service) listen(ctx context.Context, wake chan<- struct{}) {
	restart.Loop(ctx, s.log, "jobs: listener stopped; retrying", func(ctx context.Context) error {
		return s.listenOnce(ctx, wake)
	})
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
