package db_test

import (
	"context"
	"os"
	"testing"

	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// 00070 drops channels.swept_seq and raises the floor to its own number,
// since 0.15.0's queries name the column; its Down puts both back.
func TestSweptSeqDropMigration(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() { _ = sqlDB.Close() }()
	goose.SetBaseFS(os.DirFS("."))
	defer goose.SetBaseFS(nil)

	hasColumn := func() bool {
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns WHERE table_name = 'channels' AND column_name = 'swept_seq'`).Scan(&count); err != nil {
			t.Fatal(err)
		}
		return count == 1
	}
	floor := func() int64 {
		var minMigration int64
		if err := pool.QueryRow(ctx, `SELECT min_migration FROM schema_floor`).Scan(&minMigration); err != nil {
			t.Fatal(err)
		}
		return minMigration
	}

	if hasColumn() || floor() != 70 {
		t.Fatalf("after every migration: swept_seq present %v, floor %d; want absent and 70", hasColumn(), floor())
	}
	if err := goose.DownToContext(ctx, sqlDB, "migrations", 69); err != nil {
		t.Fatal(err)
	}
	if !hasColumn() || floor() != 68 {
		t.Fatalf("after 00070's Down: swept_seq present %v, floor %d; want present and 68", hasColumn(), floor())
	}
	// A channel written while the column is back takes its default.
	var swept int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO channels (id, space_id, name, kind, dm_key) VALUES (gen_random_uuid(), NULL, '', 3, 'dm') RETURNING swept_seq`,
	).Scan(&swept); err != nil {
		t.Fatal(err)
	}
	if swept != 0 {
		t.Errorf("swept_seq on a new channel = %d, want the default 0", swept)
	}
	if err := goose.UpContext(ctx, sqlDB, "migrations"); err != nil {
		t.Fatal(err)
	}
	if hasColumn() || floor() != 70 {
		t.Errorf("after 00070 again: swept_seq present %v, floor %d; want absent and 70", hasColumn(), floor())
	}
	var channels int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM channels`).Scan(&channels); err != nil {
		t.Fatal(err)
	}
	if channels != 1 {
		t.Errorf("the channel written meanwhile should survive the drop: %d rows", channels)
	}
}
