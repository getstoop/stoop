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

// Migration 00065 rewrites the action a credential was granted under its
// old name, and leaves its other grants alone.
func TestMentionsEntireChannelMigrationRewritesGrants(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() { _ = sqlDB.Close() }()
	goose.SetBaseFS(os.DirFS("."))
	defer goose.SetBaseFS(nil)
	if err := goose.DownToContext(ctx, sqlDB, "migrations", 64); err != nil {
		t.Fatal(err)
	}
	var botID, hookID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (id, username, role) VALUES (gen_random_uuid(), 'uptime', 'member') RETURNING id`,
	).Scan(&botID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO credentials (id, holder_id, kind, token_hash, grants)
		 VALUES (gen_random_uuid(), $1, 'incoming_hook', 'hash', '{messages.post,messages.notify_everyone}') RETURNING id`,
		botID,
	).Scan(&hookID); err != nil {
		t.Fatal(err)
	}
	if err := goose.UpContext(ctx, sqlDB, "migrations"); err != nil {
		t.Fatal(err)
	}
	var grants []string
	if err := pool.QueryRow(ctx, `SELECT grants FROM credentials WHERE id = $1`, hookID).Scan(&grants); err != nil {
		t.Fatal(err)
	}
	if want := []string{"messages.post", "messages.notify_entire_channel"}; !slices.Equal(grants, want) {
		t.Errorf("grants after the migration = %v, want %v", grants, want)
	}
}
