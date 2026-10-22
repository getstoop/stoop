package db_test

import (
	"context"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

// Migration 00069 is the channel log's contract half. A row with no seq
// was written by a 0.13.0 binary during a rollback from 0.14.0; the
// migration gives such rows positions above their channel's counter, in
// id order, moves the counter past them, and only then makes the column
// NOT NULL. A channel with no such rows is left exactly as it was, and
// the floor rises to 68, the last migration 0.14.0 shipped.
func TestChannelSeqContractMigrationFillsRollbackRows(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() { _ = sqlDB.Close() }()
	goose.SetBaseFS(os.DirFS("."))
	defer goose.SetBaseFS(nil)
	if err := goose.DownToContext(ctx, sqlDB, "migrations", 68); err != nil {
		t.Fatal(err)
	}
	var user string
	if err := pool.QueryRow(ctx, `INSERT INTO users (id, username) VALUES (gen_random_uuid(), 'ada') RETURNING id`).Scan(&user); err != nil {
		t.Fatal(err)
	}
	channels := map[string]string{}
	for _, name := range []string{"rolled", "steady"} {
		var id string
		if err := pool.QueryRow(ctx,
			`INSERT INTO channels (id, space_id, name, kind, dm_key) VALUES (gen_random_uuid(), NULL, '', 3, $1) RETURNING id`,
			name).Scan(&id); err != nil {
			t.Fatal(err)
		}
		channels[name] = id
	}
	// insert writes a row the way a binary did, under a UUIDv7 so id order
	// is write order: 0.14.0 stamps it, 0.13.0 knows no seq and leaves it
	// NULL. It returns the row's id.
	insert := func(channel string, seq *int64) string {
		t.Helper()
		id, err := uuid.NewV7()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO messages (id, channel_id, author_id, content, seq) VALUES ($1, $2, $3, 'hi', $4)`,
			id.String(), channels[channel], user, seq); err != nil {
			t.Fatal(err)
		}
		return id.String()
	}
	stamped := func(seq int64) *int64 { return &seq }
	// The rolled channel: 0.14.0 wrote three rows and its counter stands
	// at 7 (edits and reactions spend positions too); then 0.13.0 wrote
	// three more with no seq. The steady channel's rows were all stamped
	// (one by 0.14.0 after the rollback, so its seq is above the others').
	insert("rolled", stamped(2))
	insert("rolled", stamped(5))
	insert("rolled", stamped(7))
	insert("steady", stamped(1))
	rollback := []string{insert("rolled", nil)}
	insert("steady", stamped(3))
	rollback = append(rollback, insert("rolled", nil), insert("rolled", nil))
	for name, seq := range map[string]int64{"rolled": 7, "steady": 3} {
		if _, err := pool.Exec(ctx, `UPDATE channels SET seq = $2 WHERE id = $1`, channels[name], seq); err != nil {
			t.Fatal(err)
		}
	}

	if err := goose.UpContext(ctx, sqlDB, "migrations"); err != nil {
		t.Fatal(err)
	}

	// The rollback rows took 8, 9, 10 in id order, above every stamp the
	// channel had, and the counter followed them.
	for index, id := range rollback {
		var seq, viewed int64
		if err := pool.QueryRow(ctx, `SELECT m.seq, v.seq FROM messages m JOIN message_with_reply v ON v.id = m.id WHERE m.id = $1`, id).Scan(&seq, &viewed); err != nil {
			t.Fatal(err)
		}
		if want := int64(8 + index); seq != want || viewed != want {
			t.Errorf("rollback row %d: seq %d, view reads %d, want %d", index, seq, viewed, want)
		}
	}
	var rolledSeqs []int64
	rows, err := pool.Query(ctx, `SELECT seq FROM messages WHERE channel_id = $1 ORDER BY id`, channels["rolled"])
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var seq int64
		if err := rows.Scan(&seq); err != nil {
			t.Fatal(err)
		}
		rolledSeqs = append(rolledSeqs, seq)
	}
	rows.Close()
	if want := []int64{2, 5, 7, 8, 9, 10}; !slices.Equal(rolledSeqs, want) {
		t.Errorf("rolled channel's seqs in id order = %v, want %v", rolledSeqs, want)
	}
	for name, want := range map[string]int64{"rolled": 10, "steady": 3} {
		var seq int64
		if err := pool.QueryRow(ctx, `SELECT seq FROM channels WHERE id = $1`, channels[name]).Scan(&seq); err != nil {
			t.Fatal(err)
		}
		if seq != want {
			t.Errorf("%s channel counter = %d, want %d", name, seq, want)
		}
	}
	var nulls int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM messages WHERE seq IS NULL`).Scan(&nulls); err != nil {
		t.Fatal(err)
	}
	if nulls != 0 {
		t.Errorf("%d rows still have no seq", nulls)
	}
	// The column is required now: an insert without a seq is refused.
	_, err = pool.Exec(ctx, `INSERT INTO messages (id, channel_id, author_id, content) VALUES (gen_random_uuid(), $1, $2, 'late')`, channels["steady"], user)
	if err == nil || !strings.Contains(err.Error(), "not-null") {
		t.Errorf("insert without seq: err = %v, want a not-null violation", err)
	}
	var floor int64
	if err := pool.QueryRow(ctx, `SELECT min_migration FROM schema_floor`).Scan(&floor); err != nil {
		t.Fatal(err)
	}
	if floor != 68 {
		t.Errorf("schema_floor = %d, want 68 (0.14.0 starts, 0.13.0 refuses)", floor)
	}
}
