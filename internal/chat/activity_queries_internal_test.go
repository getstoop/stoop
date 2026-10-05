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
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

// sendQueryCounter counts, on every connection of a pool and inside
// transactions too, the queries that write mention rows and the ones
// that deliver activity: blocks, activity items and mutes.
type sendQueryCounter struct {
	mentions atomic.Int64
	activity atomic.Int64
}

func (counter *sendQueryCounter) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	switch {
	case strings.Contains(data.SQL, "INSERT INTO message_mentions"):
		counter.mentions.Add(1)
	case strings.Contains(data.SQL, "activity_items"), strings.Contains(data.SQL, "channel_mutes"),
		strings.Contains(data.SQL, "space_mutes"), strings.Contains(data.SQL, "user_blocks"):
		counter.activity.Add(1)
	}
	return ctx
}

func (counter *sendQueryCounter) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

type noUsers struct{}

func (noUsers) GetUsers(context.Context, []string) ([]UserRecord, error) { return nil, nil }

// An @everyone costs the same few mention and activity queries however
// big the space.
func TestEveryoneSendQueriesDoNotGrowWithTheSpace(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	counter := &sendQueryCounter{}
	config := pool.Config()
	config.ConnConfig.Tracer = counter
	traced, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(traced.Close)
	svc := New(traced, events.NewInProcBus(), noUsers{})

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
	// others, and counts the queries it made.
	sendEveryone := func(members int) (mentions, activity int64) {
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
		counter.mentions.Store(0)
		counter.activity.Store(0)
		if _, err := svc.SendMessage(casey, connect.NewRequest(&chatv1.SendMessageRequest{
			ChannelId: space.Msg.DefaultChannel.Id, Content: "@everyone game night",
		})); err != nil {
			t.Fatal(err)
		}
		return counter.mentions.Load(), counter.activity.Load()
	}

	smallMentions, smallActivity := sendEveryone(3)
	largeMentions, largeActivity := sendEveryone(20)
	t.Logf("mention queries: %d for a space of 3, %d for 20; activity queries: %d and %d",
		smallMentions, largeMentions, smallActivity, largeActivity)
	// One insert for every mention row; blocks, items and mutes for the
	// alerts. Exact, so a slower send fails even if its cost stays flat.
	const wantMentions, wantActivity = 1, 3
	for _, size := range []struct {
		members            int
		mentions, activity int64
	}{{3, smallMentions, smallActivity}, {20, largeMentions, largeActivity}} {
		if size.mentions != wantMentions || size.activity != wantActivity {
			t.Errorf("space of %d: %d mention and %d activity queries, want %d and %d",
				size.members, size.mentions, size.activity, wantMentions, wantActivity)
		}
	}

	var mentionRows, items int
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM message_mentions), (SELECT count(*) FROM activity_items WHERE kind = 'mention')`).Scan(&mentionRows, &items); err != nil {
		t.Fatal(err)
	}
	if want := 2 + 19; mentionRows != want || items != want {
		t.Errorf("mention rows = %d, items = %d, want %d each", mentionRows, items, want)
	}
}
