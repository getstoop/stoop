package db_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

// Migration 00039 gives a server that predates owners one: its
// longest-serving active admin, never a member or a deactivated admin.
func TestOwnerMigrationPicksLongestServingActiveAdmin(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() { _ = sqlDB.Close() }()
	goose.SetBaseFS(os.DirFS("."))
	defer goose.SetBaseFS(nil)
	if err := goose.DownToContext(ctx, sqlDB, "migrations", 38); err != nil {
		t.Fatal(err)
	}
	for _, u := range []struct{ name, role, created, deactivated string }{
		{"mia", "member", "2026-01-01", ""},
		{"gone", "admin", "2026-01-02", "2026-02-01"},
		{"ada", "admin", "2026-01-03", ""},
		{"bea", "admin", "2026-01-04", ""},
	} {
		var deactivated any
		if u.deactivated != "" {
			deactivated = u.deactivated
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO users (id, username, role, created_at, deactivated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
			u.name, u.role, u.created, deactivated); err != nil {
			t.Fatal(err)
		}
	}
	if err := goose.UpContext(ctx, sqlDB, "migrations"); err != nil {
		t.Fatal(err)
	}
	var owners []string
	rows, err := pool.Query(ctx, `SELECT username FROM users WHERE is_owner`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		owners = append(owners, name)
	}
	if len(owners) != 1 || owners[0] != "ada" {
		t.Errorf("owners = %v, want [ada]", owners)
	}

	// Whatever writes the row, the owner stays an active admin, and alone.
	for _, bad := range []string{
		`UPDATE users SET role = 'member' WHERE username = 'ada'`,
		`UPDATE users SET deactivated_at = now() WHERE username = 'ada'`,
		`UPDATE users SET is_owner = true WHERE username = 'bea'`,
	} {
		if _, err := pool.Exec(ctx, bad); err == nil {
			t.Errorf("%s was allowed", bad)
		}
	}
}
