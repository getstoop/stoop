package db_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

const migrateWait = 15 * time.Second

func TestMigrateWaitsForTheAdvisoryLock(t *testing.T) {
	ctx := context.Background()
	databaseURL := dbtest.NewURL(t)
	holder, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = holder.Close(ctx) })
	if _, err := holder.Exec(ctx, "SELECT pg_advisory_lock($1)", db.MigrateLockKey); err != nil {
		t.Fatal(err)
	}
	pool := connectForTest(t, databaseURL)

	returned := startMigrate(ctx, pool)
	select {
	case err := <-returned:
		t.Fatalf("Migrate returned %v while the lock was held", err)
	case <-time.After(300 * time.Millisecond):
	}
	var started bool
	if err := holder.QueryRow(ctx, "SELECT to_regclass('public.goose_db_version') IS NOT NULL").Scan(&started); err != nil {
		t.Fatal(err)
	}
	if started {
		t.Fatal("Migrate wrote the schema while the lock was held")
	}

	if _, err := holder.Exec(ctx, "SELECT pg_advisory_unlock($1)", db.MigrateLockKey); err != nil {
		t.Fatal(err)
	}
	expectMigrated(t, returned)
	if versions := countRows(t, pool, "SELECT count(*) FROM goose_db_version"); versions == 0 {
		t.Error("goose_db_version is empty after Migrate")
	}
}

func TestConcurrentMigratesApplyEachVersionOnce(t *testing.T) {
	ctx := context.Background()
	databaseURL := dbtest.NewURL(t)
	first := connectForTest(t, databaseURL)
	second := connectForTest(t, databaseURL)

	firstReturned := startMigrate(ctx, first)
	secondReturned := startMigrate(ctx, second)
	expectMigrated(t, firstReturned)
	expectMigrated(t, secondReturned)

	duplicates := countRows(t, first, `SELECT count(*) FROM (
		SELECT version_id FROM goose_db_version GROUP BY version_id HAVING count(*) > 1) AS repeated`)
	if duplicates != 0 {
		t.Errorf("%d versions recorded more than once", duplicates)
	}
}

// connectForTest opens a pool that closes before dbtest drops the database.
func connectForTest(t *testing.T, databaseURL string) *pgxpool.Pool {
	t.Helper()
	pool, err := db.Connect(context.Background(), databaseURL, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// startMigrate runs db.Migrate in the background and delivers its result.
func startMigrate(ctx context.Context, pool *pgxpool.Pool) <-chan error {
	returned := make(chan error, 1)
	go func() { returned <- db.Migrate(ctx, pool) }()
	return returned
}

// expectMigrated waits for a Migrate started with startMigrate to return nil.
func expectMigrated(t *testing.T, returned <-chan error) {
	t.Helper()
	select {
	case err := <-returned:
		if err != nil {
			t.Fatalf("Migrate: %v", err)
		}
	case <-time.After(migrateWait):
		t.Fatal("Migrate did not return")
	}
}

func countRows(t *testing.T, pool *pgxpool.Pool, query string) int64 {
	t.Helper()
	var count int64
	if err := pool.QueryRow(context.Background(), query).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	return count
}
