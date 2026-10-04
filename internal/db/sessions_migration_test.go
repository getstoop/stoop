package db_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

// Migration 00049 drops sessions after carrying over the live rows a
// rolled-back 0.1.0 could have written, and leaves rows already in
// credentials and expired rows alone.
func TestDropSessionsMigrationCarriesLiveSessions(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() { _ = sqlDB.Close() }()
	goose.SetBaseFS(os.DirFS("."))
	defer goose.SetBaseFS(nil)
	if err := goose.DownToContext(ctx, sqlDB, "migrations", 48); err != nil {
		t.Fatal(err)
	}
	var userID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (id, username, role) VALUES (gen_random_uuid(), 'ada', 'admin') RETURNING id`,
	).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ('00000000-0000-0000-0000-000000000001', $1, 'live', now() + interval '1 day')`,
		`INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ('00000000-0000-0000-0000-000000000002', $1, 'expired', now() - interval '1 day')`,
		`INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ('00000000-0000-0000-0000-000000000003', $1, 'copied', now() + interval '1 day')`,
		`INSERT INTO credentials (id, holder_id, kind, token_hash, expires_at) VALUES ('00000000-0000-0000-0000-000000000003', $1, 'session', 'copied', now() + interval '1 day')`,
	} {
		if _, err := pool.Exec(ctx, statement, userID); err != nil {
			t.Fatal(err)
		}
	}
	if err := goose.UpContext(ctx, sqlDB, "migrations"); err != nil {
		t.Fatal(err)
	}

	var hashes []string
	rows, err := pool.Query(ctx, `SELECT convert_from(token_hash, 'UTF8') FROM credentials WHERE holder_id = $1 ORDER BY id`, userID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var hash string
		if err := rows.Scan(&hash); err != nil {
			t.Fatal(err)
		}
		hashes = append(hashes, hash)
	}
	if len(hashes) != 2 || hashes[0] != "live" || hashes[1] != "copied" {
		t.Errorf("credentials = %v, want [live copied]", hashes)
	}
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('public.sessions') IS NOT NULL`).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Error("sessions survived the migration")
	}
}
