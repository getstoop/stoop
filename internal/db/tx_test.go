package db_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/apierr/apierrtest"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

func TestInTx(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, "CREATE TABLE tx_probe (name text PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	insert := func(name string) func(tx pgx.Tx) error {
		return func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, "INSERT INTO tx_probe (name) VALUES ($1)", name)
			return err
		}
	}
	exists := func(name string) bool {
		var found bool
		if err := pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM tx_probe WHERE name = $1)", name).Scan(&found); err != nil {
			t.Fatal(err)
		}
		return found
	}

	if err := db.InTx(ctx, pool, insert("committed")); err != nil {
		t.Fatalf("InTx: %v", err)
	}
	if !exists("committed") {
		t.Error("work that returned nil was not committed")
	}

	refusal := connect.NewError(connect.CodePermissionDenied, errors.New("not yours"))
	err := db.InTx(ctx, pool, func(tx pgx.Tx) error {
		if err := insert("rolled back")(tx); err != nil {
			return err
		}
		return refusal
	})
	if err != refusal {
		t.Fatalf("InTx returned %v, want the work's own error", err)
	}
	apierrtest.ExpectCode(t, err, connect.CodePermissionDenied, "InTx")
	if exists("rolled back") {
		t.Error("work that returned an error was committed")
	}
}
