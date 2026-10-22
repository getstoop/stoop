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

// A database 0.15.0 made (newest 69) upgrading to this binary meets the
// contract migration 00070, which drops a column 0.15.0's generated
// queries name (sqlc expands channels.* into column lists): the floor
// goes from 68 to 70, so the plan says the release that made the database
// cannot start against the result, only the one that ships 00070.
func TestInspectContractFromPreviousRelease(t *testing.T) {
	ctx := context.Background()
	pool, err := db.Connect(ctx, dbtest.NewURL(t), 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	// A 0.15.0 database: 00069 applied, floor 68.
	if err := db.MigrateTo(ctx, pool, 69); err != nil {
		t.Fatal(err)
	}
	plan, err := db.Inspect(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Applied != 69 || plan.Floor != 68 || plan.FloorAfter != 70 || !plan.Contract() || plan.Refused() != nil {
		t.Errorf("database at 69: %+v", plan)
	}
	if len(plan.Pending) == 0 || plan.Pending[0].Version != 70 || plan.Pending[0].Name != "drop_swept_seq" {
		t.Errorf("pending should start at 00070_drop_swept_seq: %+v", plan.Pending)
	}
	// 00070 refuses the release before it: 0.15.0's newest migration is
	// below the new floor. (Whether a release can start against it depends
	// on whether the release that ships 00070 has a row yet, which the
	// release-candidate workflow adds, so that is not asserted.)
	for _, release := range db.Releases {
		if release.Version == "0.15.0" && release.Migration >= plan.FloorAfter {
			t.Errorf("0.15.0 (migration %d) should be refused by floor %d", release.Migration, plan.FloorAfter)
		}
	}
	if release, ok := db.OldestStartable(plan.Floor); !ok || release.Version != "0.14.0" {
		t.Errorf("oldest release starting against floor %d = %+v %v, want 0.14.0", plan.Floor, release, ok)
	}
}
