package main

import (
	"bytes"
	"context"
	"strings"
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

func TestRunAdminSetting(t *testing.T) {
	databaseURL := dbtest.NewURL(t)
	pool, err := db.Connect(context.Background(), databaseURL, 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	pool.Close()
	t.Setenv("STOOP_DATABASE_URL", databaseURL)
	t.Setenv("STOOP_PUBLIC_URL", "https://env.example.com")
	run := func(args ...string) (int, string) {
		var out bytes.Buffer
		code := runAdmin(t.Context(), append([]string{"setting"}, args...), &out)
		return code, out.String()
	}

	if code, out := run("list"); code != 0 || !strings.Contains(out, "https://env.example.com") {
		t.Errorf("list: exit %d\n%s", code, out)
	}
	if code, out := run("set", "tailscale.enabled=true", "tailscale.hostname=porch"); code != 0 || !strings.Contains(out, "restart") {
		t.Errorf("set tailscale: exit %d\n%s", code, out)
	}
	if code, _ := run("set", "public-url"); code != 2 {
		t.Errorf("set without =: exit %d, want 2", code)
	}
	if code, _ := run("set", "public-url=chat.example.com"); code != 1 {
		t.Errorf("set a bare host: exit %d, want 1", code)
	}
	if code, out := run("clear", "public-url"); code != 0 || out != "saved\n" {
		t.Errorf("clear: exit %d\n%s", code, out)
	}
	if code, out := run("reset", "public-url"); code != 0 || !strings.Contains(out, "restart it if .env has changed") {
		t.Errorf("reset: exit %d\n%s", code, out)
	}
	if code, _ := run("bogus"); code != 2 {
		t.Errorf("unknown command: exit %d, want 2", code)
	}
}
