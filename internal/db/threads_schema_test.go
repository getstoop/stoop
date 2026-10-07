package db_test

import (
	"context"
	"testing"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

// Migration 00056: a reply kept out of the channel must belong to a
// thread, and really deleting a root takes its replies and summary with
// it (the sweep and Delete thread rely on that).
func TestThreadsSchema(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) error {
		_, err := pool.Exec(ctx, sql, args...)
		return err
	}
	var user, channel, root, reply string
	if err := pool.QueryRow(ctx, `INSERT INTO users (id, username) VALUES (gen_random_uuid(), 'ada') RETURNING id`).Scan(&user); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO channels (id, space_id, name, kind, dm_key) VALUES (gen_random_uuid(), NULL, '', 3, $1) RETURNING id`,
		user).Scan(&channel); err != nil {
		t.Fatal(err)
	}
	insert := func(threadRoot any, inChannel bool) (string, error) {
		var id string
		err := pool.QueryRow(ctx,
			`INSERT INTO messages (id, channel_id, author_id, content, thread_root_id, in_channel)
			 VALUES (gen_random_uuid(), $1, $2, 'hi', $3, $4) RETURNING id`,
			channel, user, threadRoot, inChannel).Scan(&id)
		return id, err
	}

	if _, err := insert(nil, false); err == nil {
		t.Error("a message outside the channel with no thread was allowed")
	}
	var err error
	if root, err = insert(nil, true); err != nil {
		t.Fatal(err)
	}
	if reply, err = insert(root, false); err != nil {
		t.Fatal(err)
	}
	if err := exec(`INSERT INTO threads (root_message_id, reply_count, last_reply_id) VALUES ($1, 1, $2)`, root, reply); err != nil {
		t.Fatal(err)
	}

	var count int32
	var inChannel bool
	if err := pool.QueryRow(ctx,
		`SELECT thread_reply_count, in_channel FROM message_with_reply WHERE id = $1`, root).Scan(&count, &inChannel); err != nil {
		t.Fatal(err)
	}
	if count != 1 || !inChannel {
		t.Errorf("root reads count %d in_channel %v, want 1 true", count, inChannel)
	}

	if err := exec(`DELETE FROM messages WHERE id = $1`, root); err != nil {
		t.Fatal(err)
	}
	var left int
	if err := pool.QueryRow(ctx,
		`SELECT (SELECT count(*) FROM messages) + (SELECT count(*) FROM threads)`).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Errorf("%d rows left after deleting the root, want 0", left)
	}
}
