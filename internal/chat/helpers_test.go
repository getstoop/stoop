package chat_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

// newTestService is the chat service on a fresh database, reading users
// from it as the app does.
func newTestService(t *testing.T) (*pgxpool.Pool, *events.InProcBus, *chat.Service) {
	t.Helper()
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	return pool, bus, chat.New(pool, bus, dbDirectory{pool})
}

type noDirectory struct{}

func (noDirectory) GetUsers(context.Context, []string) ([]chat.UserRecord, error) { return nil, nil }

// dbDirectory reads users straight from the table, as the auth-backed
// adapter in internal/app would.
type dbDirectory struct{ pool *pgxpool.Pool }

func (d dbDirectory) GetUsers(ctx context.Context, ids []string) ([]chat.UserRecord, error) {
	rows, err := d.pool.Query(ctx,
		`SELECT id, username, COALESCE(display_name, ''), role, deleted_at IS NOT NULL
		 FROM users WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []chat.UserRecord
	for rows.Next() {
		var record chat.UserRecord
		var role string
		if err := rows.Scan(&record.ID, &record.Username, &record.DisplayName, &role, &record.Deleted); err != nil {
			return nil, err
		}
		record.InstanceAdmin = role == "admin"
		out = append(out, record)
	}
	return out, rows.Err()
}

// newUser adds a person and returns them signed in.
func newUser(t *testing.T, pool *pgxpool.Pool, name string, role authctx.Role) context.Context {
	t.Helper()
	id := dbtest.NewUser(t, pool, name, string(role))
	return authctx.WithIdentity(context.Background(), authctx.Identity{UserID: id, Role: role})
}

func code(err error) connect.Code {
	var cerr *connect.Error
	if errors.As(err, &cerr) {
		return cerr.Code()
	}
	return 0
}
