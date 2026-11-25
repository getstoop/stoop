package db_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

// 00079 adds reminders. A channel's delete takes its waiting reminders
// with it. Its Down drops the table and leaves a reminder already
// posted, which the schema below it reads as a kind it does not know.
func TestRemindersMigration(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() { _ = sqlDB.Close() }()
	goose.SetBaseFS(os.DirFS("."))
	defer goose.SetBaseFS(nil)

	var user string
	if err := pool.QueryRow(ctx, `INSERT INTO users (id, username) VALUES (gen_random_uuid(), 'ada') RETURNING id`).Scan(&user); err != nil {
		t.Fatal(err)
	}
	conversation := func(key string) string {
		var id string
		if err := pool.QueryRow(ctx,
			`INSERT INTO channels (id, space_id, name, kind, dm_key) VALUES (gen_random_uuid(), NULL, '', 3, $1) RETURNING id`, key).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	kept, deleted := conversation("kept"), conversation("deleted")
	const waiting = `INSERT INTO reminders (id, channel_id, user_id, content, remind_at) VALUES (gen_random_uuid(), $1, $2, 'Order the pizza', now())`
	for _, channel := range []string{kept, deleted, deleted} {
		if _, err := pool.Exec(ctx, waiting, channel, user); err != nil {
			t.Fatal(err)
		}
	}
	reminders := func() int {
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM reminders`).Scan(&count); err != nil {
			t.Fatal(err)
		}
		return count
	}
	const stray = "00000000-0000-7000-8000-000000000009"
	for name, row := range map[string][3]any{
		"no channel": {stray, user, "now()"},
		"no person":  {kept, stray, "now()"},
		"no time":    {kept, user, "NULL"},
	} {
		statement := `INSERT INTO reminders (id, channel_id, user_id, content, remind_at) VALUES (gen_random_uuid(), $1, $2, 'x', ` + row[2].(string) + `)`
		if _, err := pool.Exec(ctx, statement, row[0], row[1]); err == nil {
			t.Errorf("a reminder with %s was stored", name)
		}
	}
	if _, err := pool.Exec(ctx, `DELETE FROM channels WHERE id = $1`, deleted); err != nil {
		t.Fatal(err)
	}
	if got := reminders(); got != 1 {
		t.Errorf("%d reminders after their channel's delete, want the other channel's one", got)
	}
	var indexes int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM pg_indexes WHERE tablename = 'reminders' AND indexname IN ('reminders_due', 'reminders_by_user')`).Scan(&indexes); err != nil {
		t.Fatal(err)
	}
	if indexes != 2 {
		t.Errorf("%d of the two reminder indexes exist", indexes)
	}
	// A reminder already posted: a messages row of kind 9.
	if _, err := pool.Exec(ctx,
		`INSERT INTO messages (id, channel_id, author_id, content, seq, kind, data) VALUES (gen_random_uuid(), $1, $2, 'Bring the dice', 1, 9, '{}')`,
		kept, user); err != nil {
		t.Fatal(err)
	}

	if err := goose.DownToContext(ctx, sqlDB, "migrations", 78); err != nil {
		t.Fatal(err)
	}
	var tables, posted int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_name = 'reminders'`).Scan(&tables); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM message_with_reply WHERE kind = 9 AND content = 'Bring the dice'`).Scan(&posted); err != nil {
		t.Fatal(err)
	}
	if tables != 0 || posted != 1 {
		t.Errorf("after 00079's Down: %d reminders tables, %d posted reminders through the view; want 0 and 1", tables, posted)
	}
	// The channel and the person a waiting reminder pointed at are free to go.
	if _, err := pool.Exec(ctx, `DELETE FROM messages WHERE channel_id = $1`, kept); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM channels WHERE id = $1`, kept); err != nil {
		t.Fatal(err)
	}

	if err := goose.UpContext(ctx, sqlDB, "migrations"); err != nil {
		t.Fatal(err)
	}
	if got := reminders(); got != 0 {
		t.Errorf("after going up again: %d reminders, want an empty table", got)
	}
}
