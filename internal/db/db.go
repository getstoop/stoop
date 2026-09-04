// Package db owns the Postgres connection pool and schema migrations.
// Migrations are embedded and applied automatically at startup so upgrading a
// self-hosted instance is "pull new binary, restart".
package db

import (
	"context"
	"embed"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return pool, nil
}

func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	goose.SetBaseFS(migrationsFS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	if err := checkSchemaFloor(ctx, pool); err != nil {
		return err
	}
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() { _ = sqlDB.Close() }()
	if err := goose.UpContext(ctx, sqlDB, "migrations"); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}

// checkSchemaFloor refuses to run a binary that is too old for the database.
// Additive migrations from a newer release are fine (that is what makes a
// one-step rollback work); a contract migration raises schema_floor to the
// last migration the previous release shipped, and a binary that does not
// know that migration stops here instead of failing at some later query.
func checkSchemaFloor(ctx context.Context, pool *pgxpool.Pool) error {
	var exists bool
	if err := pool.QueryRow(ctx, "SELECT to_regclass('public.schema_floor') IS NOT NULL").Scan(&exists); err != nil {
		return fmt.Errorf("read schema floor: %w", err)
	}
	if !exists {
		return nil
	}
	var floor int64
	if err := pool.QueryRow(ctx, "SELECT min_migration FROM schema_floor").Scan(&floor); err != nil {
		return fmt.Errorf("read schema floor: %w", err)
	}
	known, err := goose.CollectMigrations("migrations", 0, math.MaxInt64)
	if err != nil {
		return fmt.Errorf("read embedded migrations: %w", err)
	}
	last, err := known.Last()
	if err != nil {
		return err
	}
	if last.Version < floor {
		return fmt.Errorf("database was changed by a newer Stoop that needs migration %d or later; this binary knows up to %d: run the newer version, or restore the backup taken before it", floor, last.Version)
	}
	return nil
}
