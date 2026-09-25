package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/getstoop/stoop/internal/db"
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
	var out bytes.Buffer
	if code := runMigrate(t.Context(), nil, &out); code != 2 || !strings.Contains(out.String(), "usage: stoop migrate") {
		t.Errorf("no args: exit %d, %q", code, out.String())
	}
	if code := runMigrate(t.Context(), []string{"--json"}, &out); code != 2 {
		t.Errorf("--json alone: exit %d", code)
	}
}
