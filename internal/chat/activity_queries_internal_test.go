package chat

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

// activityCountingDB counts the queries that deliver activity: blocks,
// activity items and mutes.
type activityCountingDB struct {
	pool    *pgxpool.Pool
	queries atomic.Int64
}

func (db *activityCountingDB) count(sql string) {
	for _, table := range []string{"activity_items", "channel_mutes", "space_mutes", "user_blocks"} {
		if strings.Contains(sql, table) {
			db.queries.Add(1)
			return
		}
	}
}

func (db *activityCountingDB) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	db.count(sql)
	return db.pool.Exec(ctx, sql, args...)
}

func (db *activityCountingDB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	db.count(sql)
	return db.pool.Query(ctx, sql, args...)
}

func (db *activityCountingDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	db.count(sql)
	return db.pool.QueryRow(ctx, sql, args...)
}

type noUsers struct{}

func (noUsers) GetUsers(context.Context, []string) ([]UserRecord, error) { return nil, nil }

// An @everyone costs the same few activity queries however big the space.
func TestEveryoneActivityQueriesDoNotGrowWithTheSpace(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := New(pool, bus, noUsers{})
	ctx := context.Background()

	addUser := func(name string) string {
		t.Helper()
		id := uuid.NewString()
		if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, '', 'member')`, id, name); err != nil {
			t.Fatal(err)
		}
		return id
	}
	casey := authctx.WithIdentity(ctx, authctx.Identity{UserID: addUser("casey"), Role: authctx.RoleMember})

	// sendEveryone posts @everyone in a new space of casey and members-1
	// others, and counts the activity queries it made.
	sendEveryone := func(members int) int64 {
		t.Helper()
		space, err := svc.CreateSpace(casey, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
		if err != nil {
			t.Fatal(err)
		}
		for index := 1; index < members; index++ {
			memberID := addUser(fmt.Sprintf("member%d_%d", members, index))
			if _, err := pool.Exec(ctx, `INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, 'member')`, space.Msg.Space.Id, memberID); err != nil {
				t.Fatal(err)
			}
		}
		counter := &activityCountingDB{pool: pool}
		svc.q = dbgen.New(counter)
		defer func() { svc.q = dbgen.New(pool) }()
		if _, err := svc.SendMessage(casey, connect.NewRequest(&chatv1.SendMessageRequest{
			ChannelId: space.Msg.DefaultChannel.Id, Content: "@everyone game night",
		})); err != nil {
			t.Fatal(err)
		}
		return counter.queries.Load()
	}

	small := sendEveryone(3)
	large := sendEveryone(20)
	t.Logf("activity queries: %d for a space of 3, %d for a space of 20", small, large)
	if large != small {
		t.Errorf("activity queries grew with the space: %d for 3 members, %d for 20", small, large)
	}

	var items int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM activity_items WHERE kind = 'mention'`).Scan(&items); err != nil {
		t.Fatal(err)
	}
	if want := 2 + 19; items != want {
		t.Errorf("mention items = %d, want %d", items, want)
	}
}
