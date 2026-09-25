package db_test

import (
	"context"
	"slices"
	"testing"

	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

func TestInspectUpToDate(t *testing.T) {
	pool := dbtest.New(t)
	p, err := db.Inspect(context.Background(), pool)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Pending) != 0 || len(p.Ahead) != 0 || p.Applied != p.Newest || p.Floor != db.Floor || p.FloorAfter != db.Floor || p.Contract() || p.Refused() != nil {
		t.Errorf("fully migrated database: %+v", p)
	}
}

func TestInspectOlderRelease(t *testing.T) {
	ctx := context.Background()
	pool, err := db.Connect(ctx, dbtest.NewURL(t), 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := db.MigrateTo(ctx, pool, 37); err != nil {
		t.Fatal(err)
	}
	p, err := db.Inspect(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if p.Applied != 37 || len(p.Pending) == 0 || p.Pending[0].Version != 38 || p.Pending[0].Name != "session_user_agent" || len(p.Ahead) != 0 {
		t.Errorf("database at 37: %+v", p)
	}
	if p.Pending[len(p.Pending)-1].Version != p.Newest {
		t.Errorf("pending should end at the newest migration %d: %+v", p.Newest, p.Pending)
	}
	if p.Contract() != (db.Floor > p.Floor) {
		t.Errorf("Contract() = %v with floor %d → %d", p.Contract(), p.Floor, p.FloorAfter)
	}
}

func TestInspectEmptyDatabase(t *testing.T) {
	ctx := context.Background()
	pool, err := db.Connect(ctx, dbtest.NewURL(t), 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	p, err := db.Inspect(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if p.Applied != 0 || p.Floor != 0 || len(p.Pending) == 0 || p.Pending[0].Version != 1 {
		t.Errorf("empty database: %+v", p)
	}
}

func TestInspectAheadAndRefused(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, "INSERT INTO goose_db_version (version_id, is_applied) VALUES (999999, true)"); err != nil {
		t.Fatal(err)
	}
	p, err := db.Inspect(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(p.Ahead, []int64{999999}) || p.Applied != 999999 || len(p.Pending) != 0 || p.Refused() != nil {
		t.Errorf("additive newer schema should be ahead but not refused: %+v", p)
	}
	if _, err := pool.Exec(ctx, "UPDATE schema_floor SET min_migration = 999999"); err != nil {
		t.Fatal(err)
	}
	if p, err = db.Inspect(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if p.Refused() == nil || p.FloorAfter != 999999 {
		t.Errorf("floor above the binary should be refused: %+v", p)
	}
}
