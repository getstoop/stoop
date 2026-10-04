package main

import (
	"bytes"
	"context"
	"testing"

	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

func TestAdminRefusal(t *testing.T) {
	if err := adminRefusal(db.Plan{Applied: 37, Newest: 42, Pending: []db.Migration{{Version: 38, Name: "x"}}}); err == nil {
		t.Error("behind: no refusal")
	}
	if err := adminRefusal(db.Plan{Applied: 999, Newest: 42, Floor: 999}); err == nil {
		t.Error("too old: no refusal")
	}
	if err := adminRefusal(db.Plan{Applied: 45, Newest: 42, Ahead: []int64{45}}); err != nil {
		t.Errorf("ahead, additive: %v", err)
	}
	if err := adminRefusal(db.Plan{Applied: 42, Newest: 42}); err != nil {
		t.Errorf("up to date: %v", err)
	}
}

func TestRunAdminLeavesBehindDatabaseAlone(t *testing.T) {
	databaseURL := dbtest.NewURL(t)
	t.Setenv("STOOP_DATABASE_URL", databaseURL)
	var out bytes.Buffer
	if code := runAdmin(t.Context(), []string{"list"}, &out); code != 3 {
		t.Fatalf("list on an empty database: exit %d, want 3", code)
	}
	pool, err := db.Connect(context.Background(), databaseURL, 1)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	plan, err := db.Inspect(context.Background(), pool)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Applied != 0 {
		t.Errorf("admin migrated the database to %d", plan.Applied)
	}
}
