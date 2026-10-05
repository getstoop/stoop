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

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/db"
)

const envVar = "STOOP_TEST_DATABASE_URL"

// New creates a fresh database on the server named by STOOP_TEST_DATABASE_URL,
// runs all migrations, and drops it when the test finishes.
func New(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := db.Connect(ctx, NewURL(t), 0)
	if err != nil {
		t.Fatalf("connect to test database: %v", err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		pool.Close()
		t.Fatalf("migrate test database: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// NewURL creates a fresh, unmigrated database and returns its URL, for a
// test that connects and migrates itself (the whole app, say). It is
// dropped when the test finishes; whatever connected must have closed.
func NewURL(t *testing.T) string {
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

	parsed, err := url.Parse(baseURL)
	if err != nil {
		t.Fatal(err)
	}
	parsed.Path = "/" + name
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if _, err := admin.Exec(ctx, "DROP DATABASE "+name); err != nil {
			t.Logf("drop test database %s: %v", name, err)
		}
		admin.Close()
	})
	return parsed.String()
}

// NewUser adds a person with no password and returns their id, for a
// module test that may not import auth. role is "admin" or "member".
func NewUser(t *testing.T, pool *pgxpool.Pool, username, role string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, '', $3)`, id, username, role); err != nil {
		t.Fatalf("add user %s: %v", username, err)
	}
	return id
}
