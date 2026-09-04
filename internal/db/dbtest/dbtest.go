// Package dbtest provides throwaway, fully migrated databases for
// integration tests. Tests skip when STOOP_TEST_DATABASE_URL is unset
// (CI sets it; locally point it at the dev Postgres on :5440).
package dbtest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/db"
)

const envVar = "STOOP_TEST_DATABASE_URL"

// New creates a fresh database on the server named by STOOP_TEST_DATABASE_URL,
// runs all migrations, and drops it when the test finishes.
func New(t *testing.T) *pgxpool.Pool {
	t.Helper()
	baseURL := os.Getenv(envVar)
	if baseURL == "" {
		t.Skipf("%s not set; skipping database test", envVar)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	admin, err := pgxpool.New(ctx, baseURL)
	if err != nil {
		t.Fatalf("connect to %s: %v", envVar, err)
	}

	var suffix [6]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		t.Fatal(err)
	}
	name := "stoop_test_" + hex.EncodeToString(suffix[:])
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		admin.Close()
		t.Fatalf("create test database: %v", err)
	}

	u, err := url.Parse(baseURL)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	pool, err := db.Connect(ctx, u.String())
	if err != nil {
		t.Fatalf("connect to test database: %v", err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		pool.Close()
		t.Fatalf("migrate test database: %v", err)
	}

	t.Cleanup(func() {
		pool.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if _, err := admin.Exec(ctx, "DROP DATABASE "+name); err != nil {
			t.Logf("drop test database %s: %v", name, err)
		}
		admin.Close()
	})
	return pool
}
