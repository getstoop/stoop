package main

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

func TestPlanExit(t *testing.T) {
	if got := planExit(db.Plan{Applied: 37, Newest: 42, Pending: []db.Migration{{Version: 38, Name: "x"}}}); got != 2 {
		t.Errorf("pending: exit %d, want 2", got)
	}
	if got := planExit(db.Plan{Applied: 999, Newest: 42, Floor: 999}); got != 3 {
		t.Errorf("refused: exit %d, want 3", got)
	}
	if got := planExit(db.Plan{Applied: 42, Newest: 42}); got != 0 {
		t.Errorf("up to date: exit %d, want 0", got)
	}
}

func TestWriteReportJSON(t *testing.T) {
	var out bytes.Buffer
	writeReport(&out, db.Plan{Applied: 42, Newest: 42}.Report("0.3.0"), true, true)
	if !strings.HasPrefix(out.String(), `{"binary":"0.3.0"`) || !strings.Contains(out.String(), `"startable":"0.1.0"`) {
		t.Errorf("json: %s", out.String())
	}
}

func TestRunMigrateUsage(t *testing.T) {
	console, out, errOut := bufferedStreams()
	if code := runMigrate(t.Context(), nil, console); code != 2 || !strings.Contains(out.String(), "usage: stoop migrate") || errOut.Len() != 0 {
		t.Errorf("no args: exit %d, out %q, err %q", code, out.String(), errOut.String())
	}
	if code := runMigrate(t.Context(), []string{"--json"}, console); code != 2 {
		t.Errorf("--json alone: exit %d", code)
	}
	console, out, errOut = bufferedStreams()
	if code := runMigrate(t.Context(), []string{"down"}, console); code != 2 || out.Len() != 0 || errOut.String() != "unknown migrate command \"down\"\n\n"+migrateUsage {
		t.Errorf("down: exit %d, out %q, err %q", code, out.String(), errOut.String())
	}
}

func TestRunMigrateInvalidConfiguration(t *testing.T) {
	t.Setenv("STOOP_DATABASE_URL", "")
	console, out, errOut := bufferedStreams()
	if code := runMigrate(t.Context(), []string{"status"}, console); code != 1 || out.Len() != 0 || !strings.HasPrefix(errOut.String(), "invalid configuration: ") {
		t.Errorf("exit %d, out %q, err %q", code, out.String(), errOut.String())
	}
}

// up refuses a database a newer release contracted with exit 3, the same
// code plan uses, and applies nothing.
func TestRunMigrateUpRefusesANewerDatabase(t *testing.T) {
	databaseURL := dbtest.NewURL(t)
	pool, err := db.Connect(context.Background(), databaseURL, 1)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := db.Migrate(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), "UPDATE schema_floor SET min_migration = 999999"); err != nil {
		t.Fatal(err)
	}
	newest, err := db.Newest()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("STOOP_DATABASE_URL", databaseURL)
	console, out, errOut := bufferedStreams()
	want := db.AheadError{Floor: 999999, Newest: newest}.Error() + "\n"
	if code := runMigrate(t.Context(), []string{"up"}, console); code != 3 || out.Len() != 0 || errOut.String() != want {
		t.Errorf("exit %d, out %q, err %q, want exit 3 and %q", code, out.String(), errOut.String(), want)
	}
}
