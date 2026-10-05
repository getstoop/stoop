// Package db owns the Postgres connection pool and schema migrations.
// Migrations are embedded and applied automatically at startup so upgrading a
// self-hosted instance is "pull new binary, restart".
package db

import (
	"context"
	"embed"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

var gooseInUse sync.Mutex

// migrateLockKey is the advisory lock one process holds while it migrates,
// so two starting together apply each migration once. The files quota lock
// is 4207011.
const migrateLockKey = 4207012

const unlockTimeout = 5 * time.Second

// Connect opens the pool. poolMax caps it; 0 keeps pgx's default.
func Connect(ctx context.Context, databaseURL string, poolMax int) (*pgxpool.Pool, error) {
	pc, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	if poolMax > math.MaxInt32 {
		return nil, fmt.Errorf("pool max %d is out of range", poolMax)
	}
	if poolMax > 0 {
		pc.MaxConns = int32(poolMax)
	}
	pool, err := pgxpool.NewWithConfig(ctx, pc)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return pool, nil
}

// Migrate applies the pending migrations under a session-level advisory
// lock, so a second process starting at the same time waits for this one
// and then finds nothing to do.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	lock, err := lockMigrations(ctx, pool)
	if err != nil {
		return err
	}
	defer lock.release()
	// goose keeps its file system and dialect in package variables; the
	// advisory lock is per database, so two databases migrating in one
	// process (parallel tests) take turns here.
	gooseInUse.Lock()
	defer gooseInUse.Unlock()
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

// migrationLock is the advisory lock on a connection of its own, outside
// the pool, so the pool's size never matters; closing the connection
// releases the lock.
type migrationLock struct{ conn *pgx.Conn }

func lockMigrations(ctx context.Context, pool *pgxpool.Pool) (*migrationLock, error) {
	conn, err := pgx.ConnectConfig(ctx, pool.Config().ConnConfig.Copy())
	if err != nil {
		return nil, fmt.Errorf("lock for migrations: %w", err)
	}
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", migrateLockKey); err != nil {
		_ = conn.Close(ctx)
		return nil, fmt.Errorf("lock for migrations: %w", err)
	}
	return &migrationLock{conn: conn}, nil
}

func (lock *migrationLock) release() {
	ctx, cancel := context.WithTimeout(context.Background(), unlockTimeout)
	defer cancel()
	_ = lock.conn.Close(ctx)
}

// checkSchemaFloor refuses to run a binary that is too old for the database.
// Additive migrations from a newer release are fine (that is what makes a
// one-step rollback work); a contract migration raises schema_floor to the
// last migration the previous release shipped, and a binary that does not
// know that migration stops here instead of failing at some later query.
func checkSchemaFloor(ctx context.Context, pool *pgxpool.Pool) error {
	floor, err := readFloor(ctx, pool)
	if err != nil {
		return err
	}
	last, err := Newest()
	if err != nil {
		return err
	}
	if last < floor {
		return AheadError{Floor: floor, Newest: last}
	}
	return nil
}

// readFloor is schema_floor, or 0 on a database from before it existed.
func readFloor(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	exists, err := tableExists(ctx, pool, "schema_floor")
	if err != nil {
		return 0, fmt.Errorf("read schema floor: %w", err)
	}
	if !exists {
		return 0, nil
	}
	var floor int64
	if err := pool.QueryRow(ctx, "SELECT min_migration FROM schema_floor").Scan(&floor); err != nil {
		return 0, fmt.Errorf("read schema floor: %w", err)
	}
	return floor, nil
}
