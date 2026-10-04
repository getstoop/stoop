package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// MigrateLockKey hands the migration lock to the db_test package.
const MigrateLockKey = migrateLockKey

// MigrateTo applies migrations up to and including version, for tests
// that need a database shaped like an older release.
func MigrateTo(ctx context.Context, pool *pgxpool.Pool, version int64) error {
	goose.SetBaseFS(migrationsFS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() { _ = sqlDB.Close() }()
	if err := goose.UpToContext(ctx, sqlDB, "migrations", version); err != nil {
		return fmt.Errorf("apply migrations to %d: %w", version, err)
	}
	return nil
}
