package db_test

import (
	"context"
	"strings"
	"testing"

	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

func TestMigrateToleratesNewerAdditiveSchema(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, "INSERT INTO goose_db_version (version_id, is_applied) VALUES (999999, true)"); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatalf("older binary against an additive newer schema should start: %v", err)
	}
}

func TestMigrateRefusesSchemaAboveFloor(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, "UPDATE schema_floor SET min_migration = 999999"); err != nil {
		t.Fatal(err)
	}
	err := db.Migrate(ctx, pool)
	if err == nil || !strings.Contains(err.Error(), "999999") {
		t.Fatalf("want refusal naming the floor, got %v", err)
	}
}

func TestFloorMatchesSchema(t *testing.T) {
	pool := dbtest.New(t)
	var floor int64
	if err := pool.QueryRow(context.Background(), "SELECT min_migration FROM schema_floor").Scan(&floor); err != nil {
		t.Fatal(err)
	}
	if floor != db.Floor {
		t.Errorf("schema_floor after every migration = %d, db.Floor = %d: a contract migration must raise both", floor, db.Floor)
	}
}
