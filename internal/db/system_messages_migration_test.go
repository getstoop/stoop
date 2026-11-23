package db_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

// 00077 adds the system message columns to a database that already holds
// messages: they take the defaults, and the view carries the columns. Its
// Down removes system rows and gives a channel that pointed at one its
// newest message back.
func TestSystemMessagesMigration(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() { _ = sqlDB.Close() }()
	goose.SetBaseFS(os.DirFS("."))
	defer goose.SetBaseFS(nil)
	if err := goose.DownToContext(ctx, sqlDB, "migrations", 76); err != nil {
		t.Fatal(err)
	}
	var user, channel, bare string
	if err := pool.QueryRow(ctx, `INSERT INTO users (id, username) VALUES (gen_random_uuid(), 'ada') RETURNING id`).Scan(&user); err != nil {
		t.Fatal(err)
	}
	for name, id := range map[string]*string{"busy": &channel, "bare": &bare} {
		if err := pool.QueryRow(ctx,
			`INSERT INTO channels (id, space_id, name, kind, dm_key) VALUES (gen_random_uuid(), NULL, '', 3, $1) RETURNING id`,
			name).Scan(id); err != nil {
			t.Fatal(err)
		}
	}
	// Ids in order, as UUIDv7 gives them: the last message is the newest.
	written := []string{
		"00000000-0000-7000-8000-000000000001",
		"00000000-0000-7000-8000-000000000002",
	}
	for index, id := range written {
		var replyTo *string // the second answers the first
		if index == 1 {
			replyTo = &written[0]
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO messages (id, channel_id, author_id, content, seq, reply_to_message_id) VALUES ($1, $2, $3, 'hi', $4, $5)`,
			id, channel, user, index+1, replyTo); err != nil {
			t.Fatal(err)
		}
	}
	if err := goose.UpContext(ctx, sqlDB, "migrations"); err != nil {
		t.Fatal(err)
	}

	var defaults, viewed int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM messages WHERE kind = 0 AND data IS NULL AND NOT quiet AND reference_message_id IS NULL`).Scan(&defaults); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM message_with_reply
		 WHERE kind = 0 AND data IS NULL AND NOT quiet AND reference_message_id IS NULL
		   AND reference_author_id IS NULL AND reference_content IS NULL AND reference_first_file_id = ''`).Scan(&viewed); err != nil {
		t.Fatal(err)
	}
	if defaults != 2 || viewed != 2 {
		t.Fatalf("after 00077: %d rows with the defaults, %d through the view; want 2 and 2", defaults, viewed)
	}

	// A system row about the first message, the newest row in its channel
	// and (as a kind that is not quiet would be) its last message; and one
	// alone in a channel.
	system := "00000000-0000-7000-8000-000000000003"
	if _, err := pool.Exec(ctx,
		`INSERT INTO messages (id, channel_id, author_id, content, seq, kind, data, reference_message_id) VALUES ($1, $2, $3, '', 3, 5, '{}', $4)`,
		system, channel, user, written[0]); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO messages (id, channel_id, author_id, content, seq, kind, data) VALUES ('00000000-0000-7000-8000-000000000004', $1, $2, '', 1, 2, '{}')`,
		bare, user); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE channels SET last_message_id = $2 WHERE id = $1`, channel, system); err != nil {
		t.Fatal(err)
	}
	var referenceAuthor, referenceContent *string
	if err := pool.QueryRow(ctx,
		`SELECT reference_author_id::text, reference_content FROM message_with_reply WHERE id = $1`, system).Scan(&referenceAuthor, &referenceContent); err != nil {
		t.Fatal(err)
	}
	if referenceAuthor == nil || *referenceAuthor != user || referenceContent == nil || *referenceContent != "hi" {
		t.Errorf("the view's reference = author %v content %v, want ada's hi", referenceAuthor, referenceContent)
	}

	if err := goose.DownToContext(ctx, sqlDB, "migrations", 76); err != nil {
		t.Fatal(err)
	}
	var columns, messages int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM information_schema.columns
		 WHERE table_name IN ('messages', 'message_with_reply')
		   AND (column_name IN ('kind', 'data', 'quiet') OR column_name LIKE 'reference\_%')`).Scan(&columns); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM messages`).Scan(&messages); err != nil {
		t.Fatal(err)
	}
	if columns != 0 || messages != 2 {
		t.Errorf("after 00077's Down: %d of its columns left, %d messages; want none and the 2 written", columns, messages)
	}
	last := func(channelID string) *string {
		var id *string
		if err := pool.QueryRow(ctx, `SELECT last_message_id::text FROM channels WHERE id = $1`, channelID).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	if got := last(channel); got == nil || *got != written[1] {
		t.Errorf("after 00077's Down: last message = %v, want the newest written message %s", got, written[1])
	}
	if got := last(bare); got != nil {
		t.Errorf("after 00077's Down: a channel with no messages left points at %s", *got)
	}
	// The reply quote still reads through the recreated view.
	var replyContent *string
	if err := pool.QueryRow(ctx, `SELECT reply_content FROM message_with_reply WHERE id = $1`, written[1]).Scan(&replyContent); err != nil {
		t.Fatal(err)
	}
	if replyContent == nil || *replyContent != "hi" {
		t.Errorf("after 00077's Down: reply quote = %v, want hi", replyContent)
	}
	if err := goose.UpContext(ctx, sqlDB, "migrations"); err != nil {
		t.Fatal(err)
	}
}
