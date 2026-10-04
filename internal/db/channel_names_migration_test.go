package db_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

// Migration 00050 renames every channel whose name folds onto an older
// one in the same space to the first free numbered suffix, then makes
// the folded name unique per space.
func TestChannelNameMigrationRenamesFoldedTwins(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() { _ = sqlDB.Close() }()
	goose.SetBaseFS(os.DirFS("."))
	defer goose.SetBaseFS(nil)
	if err := goose.DownToContext(ctx, sqlDB, "migrations", 49); err != nil {
		t.Fatal(err)
	}
	var ownerID, porchID, yardID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (id, username, role) VALUES (gen_random_uuid(), 'ada', 'admin') RETURNING id`,
	).Scan(&ownerID); err != nil {
		t.Fatal(err)
	}
	for _, space := range []struct {
		name string
		id   *string
	}{{"Porch", &porchID}, {"Yard", &yardID}} {
		if err := pool.QueryRow(ctx,
			`INSERT INTO spaces (id, name, owner_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
			space.name, ownerID,
		).Scan(space.id); err != nil {
			t.Fatal(err)
		}
	}
	for minute, channel := range []struct{ spaceID, name string }{
		{porchID, "General"},
		{porchID, "general"},
		{porchID, "GENERAL"},
		{porchID, "general-2"},
		{yardID, "general"},
	} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO channels (id, space_id, name, created_at) VALUES (gen_random_uuid(), $1, $2, '2026-01-01'::timestamptz + make_interval(mins => $3))`,
			channel.spaceID, channel.name, minute); err != nil {
			t.Fatal(err)
		}
	}
	if err := goose.UpContext(ctx, sqlDB, "migrations"); err != nil {
		t.Fatal(err)
	}

	rows, err := pool.Query(ctx, `SELECT s.name, c.name FROM channels c JOIN spaces s ON s.id = c.space_id ORDER BY c.created_at`)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for rows.Next() {
		var space, channel string
		if err := rows.Scan(&space, &channel); err != nil {
			t.Fatal(err)
		}
		got = append(got, space+"/"+channel)
	}
	want := []string{"Porch/General", "Porch/general-3", "Porch/GENERAL-4", "Porch/general-2", "Yard/general"}
	if len(got) != len(want) {
		t.Fatalf("channels = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("channels = %v, want %v", got, want)
			break
		}
	}

	_, err = pool.Exec(ctx, `INSERT INTO channels (id, space_id, name) VALUES (gen_random_uuid(), $1, 'GENERAL')`, porchID)
	if !db.HasCode(err, db.UniqueViolation) {
		t.Errorf("a folded twin was inserted after the migration: %v", err)
	}
}
