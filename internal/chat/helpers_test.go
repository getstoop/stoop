package chat_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
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

// legacyAdminInvite plants an invite as the service minted them before
// admin invites were withdrawn: CreateInvite refuses the role now, but
// rows made earlier are still honoured, so the tests write one directly.
func legacyAdminInvite(t *testing.T, pool *pgxpool.Pool, spaceID string, creator context.Context, code string) *chatv1.Invite {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO invites (id, space_id, code, created_by, role) VALUES ($1, $2, $3, $4, 'admin')`,
		id, spaceID, code, authctx.UserID(creator)); err != nil {
		t.Fatal(err)
	}
	return &chatv1.Invite{Id: id, SpaceId: spaceID, Code: code, Role: chatv1.SpaceRole_SPACE_ROLE_ADMIN}
}

func code(err error) connect.Code {
	var cerr *connect.Error
	if errors.As(err, &cerr) {
		return cerr.Code()
	}
	return 0
}

// mentionOf is the token that mentions a person, as the composer writes
// it. The server rewrites the handle to the current one.
func mentionOf(person context.Context) string {
	return "<@u:" + authctx.UserID(person) + ":someone>"
}

// groupMention is the token that mentions a group.
func groupMention(groupID string) string {
	return "<@g:" + groupID + ":somegroup>"
}
