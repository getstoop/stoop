// Package push owns push notifications: the server's signing key and the
// one Web Push subscription each signed-in session may register. It sends
// nothing yet. See docs/architecture/modules.md.
package push

import (
	"context"
	"errors"
	"sync"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

type Service struct {
	pool *pgxpool.Pool
	q    *dbgen.Queries

	keyMu     sync.Mutex
	publicKey []byte // the signing key's public point, once loaded
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, q: dbgen.New(pool)}
}

// requireSession is the caller's identity when it signed in on a device:
// a subscription belongs to a session, so a token has none to manage.
func requireSession(ctx context.Context) (authctx.Identity, error) {
	id, ok := authctx.From(ctx)
	if !ok {
		return authctx.Identity{}, connect.NewError(connect.CodeUnauthenticated, errors.New("not logged in"))
	}
	if id.SessionID == "" {
		return authctx.Identity{}, connect.NewError(connect.CodePermissionDenied,
			errors.New("only a signed-in device can receive notifications"))
	}
	return id, nil
}
