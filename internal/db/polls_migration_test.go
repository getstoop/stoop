package db_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

// 00078 adds poll_votes and the view's reference_kind to a database that
// already holds system rows. Its Down takes both away and leaves a poll's
// row, which the schema below it reads as a kind it does not know.
func TestPollsMigration(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() { _ = sqlDB.Close() }()
	goose.SetBaseFS(os.DirFS("."))
	defer goose.SetBaseFS(nil)

	var user, channel string
	if err := pool.QueryRow(ctx, `INSERT INTO users (id, username) VALUES (gen_random_uuid(), 'ada') RETURNING id`).Scan(&user); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO channels (id, space_id, name, kind, dm_key) VALUES (gen_random_uuid(), NULL, '', 3, 'pair') RETURNING id`).Scan(&channel); err != nil {
		t.Fatal(err)
	}
	const poll, closing = "00000000-0000-7000-8000-000000000001", "00000000-0000-7000-8000-000000000002"
	if _, err := pool.Exec(ctx,
		`INSERT INTO messages (id, channel_id, author_id, content, seq, kind, data) VALUES ($1, $2, $3, 'Friday?', 1, 7, '{}')`,
		poll, channel, user); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO messages (id, channel_id, author_id, content, seq, kind, data, reference_message_id) VALUES ($1, $2, $3, 'Friday?', 2, 8, '{}', $4)`,
		closing, channel, user, poll); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO poll_votes (message_id, user_id, option_id) VALUES ($1, $2, 1), ($1, $2, 2)`, poll, user); err != nil {
		t.Fatal(err)
	}
	// One row per person and option, and no more.
	if _, err := pool.Exec(ctx, `INSERT INTO poll_votes (message_id, user_id, option_id) VALUES ($1, $2, 1)`, poll, user); err == nil {
		t.Error("the same vote was stored twice")
	}
	referenceKind := func(messageID string) *int16 {
		var kind *int16
		if err := pool.QueryRow(ctx, `SELECT reference_kind FROM message_with_reply WHERE id = $1`, messageID).Scan(&kind); err != nil {
			t.Fatal(err)
		}
		return kind
	}
	if got := referenceKind(closing); got == nil || *got != 7 {
		t.Errorf("the closing row's reference_kind = %v, want 7", got)
	}
	if got := referenceKind(poll); got != nil {
		t.Errorf("a row about no message has reference_kind %d", *got)
	}

	if err := goose.DownToContext(ctx, sqlDB, "migrations", 77); err != nil {
		t.Fatal(err)
	}
	var tables, columns, rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_name = 'poll_votes'`).Scan(&tables); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM information_schema.columns WHERE table_name = 'message_with_reply' AND column_name = 'reference_kind'`).Scan(&columns); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM message_with_reply WHERE kind IN (7, 8) AND content = 'Friday?'`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if tables != 0 || columns != 0 || rows != 2 {
		t.Errorf("after 00078's Down: %d poll_votes tables, %d reference_kind columns, %d poll rows through the view; want 0, 0 and 2", tables, columns, rows)
	}

	if err := goose.UpContext(ctx, sqlDB, "migrations"); err != nil {
		t.Fatal(err)
	}
	if got := referenceKind(closing); got == nil || *got != 7 {
		t.Errorf("after going up again: the closing row's reference_kind = %v, want 7", got)
	}
	// A poll's votes go with its row, as the retention sweep removes it.
	if _, err := pool.Exec(ctx, `INSERT INTO poll_votes (message_id, user_id, option_id) VALUES ($1, $2, 1)`, poll, user); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM messages WHERE id = $1`, poll); err != nil {
		t.Fatal(err)
	}
	var votes int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM poll_votes`).Scan(&votes); err != nil {
		t.Fatal(err)
	}
	if votes != 0 {
		t.Errorf("%d votes outlived their poll", votes)
	}
}
