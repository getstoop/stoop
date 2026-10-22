package db_test

import (
	"context"
	"os"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

// Migration 00068 numbers each channel's messages 1..n in id order and
// sets the channel's counter to n; a channel with no messages stays at 0.
func TestChannelSeqMigrationBackfillsTheLog(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() { _ = sqlDB.Close() }()
	goose.SetBaseFS(os.DirFS("."))
	defer goose.SetBaseFS(nil)
	if err := goose.DownToContext(ctx, sqlDB, "migrations", 67); err != nil {
		t.Fatal(err)
	}
	var user string
	if err := pool.QueryRow(ctx, `INSERT INTO users (id, username) VALUES (gen_random_uuid(), 'ada') RETURNING id`).Scan(&user); err != nil {
		t.Fatal(err)
	}
	channels := map[string]string{}
	for _, name := range []string{"busy", "quiet", "empty"} {
		var id string
		if err := pool.QueryRow(ctx,
			`INSERT INTO channels (id, space_id, name, kind, dm_key) VALUES (gen_random_uuid(), NULL, '', 3, $1) RETURNING id`,
			name).Scan(&id); err != nil {
			t.Fatal(err)
		}
		channels[name] = id
	}
	// Interleaved, so each channel's numbering has to be its own.
	for _, name := range []string{"busy", "quiet", "busy", "busy", "quiet", "busy", "busy"} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO messages (id, channel_id, author_id, content) VALUES (gen_random_uuid(), $1, $2, 'hi')`,
			channels[name], user); err != nil {
			t.Fatal(err)
		}
	}
	if err := goose.UpContext(ctx, sqlDB, "migrations"); err != nil {
		t.Fatal(err)
	}

	for name, count := range map[string]int64{"busy": 5, "quiet": 2, "empty": 0} {
		rows, err := pool.Query(ctx, `SELECT m.seq, v.seq FROM messages m JOIN message_with_reply v ON v.id = m.id WHERE m.channel_id = $1 ORDER BY m.id`, channels[name])
		if err != nil {
			t.Fatal(err)
		}
		var seqs []int64
		for rows.Next() {
			var seq, viewed int64
			if err := rows.Scan(&seq, &viewed); err != nil {
				t.Fatal(err)
			}
			if viewed != seq {
				t.Errorf("%s: the view reads seq %d where the table has %d", name, viewed, seq)
			}
			seqs = append(seqs, seq)
		}
		rows.Close()
		var want []int64
		for seq := int64(1); seq <= count; seq++ {
			want = append(want, seq)
		}
		if !slices.Equal(seqs, want) {
			t.Errorf("%s: message seqs in id order = %v, want %v", name, seqs, want)
		}
		var channelSeq int64
		if err := pool.QueryRow(ctx, `SELECT seq FROM channels WHERE id = $1`, channels[name]).Scan(&channelSeq); err != nil {
			t.Fatal(err)
		}
		if channelSeq != count {
			t.Errorf("%s: channel seq %d, want %d", name, channelSeq, count)
		}
	}
}
