package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/getstoop/stoop/internal/buildinfo"
	"github.com/getstoop/stoop/internal/db"
)

func TestWritePlan(t *testing.T) {
	prev := buildinfo.Version
	buildinfo.Version = "v0.3.0"
	t.Cleanup(func() { buildinfo.Version = prev })

	pending := db.Plan{Applied: 37, Newest: 42, Pending: []db.Migration{{Version: 38, Name: "session_user_agent"}, {Version: 42, Name: "message_fk_indexes"}}}
	var out bytes.Buffer
	writePlan(&out, pending, true)
	for _, want := range []string{
		"database   migration 37 (0.2.0), floor 0",
		"binary     0.3.0, migration 42, floor 0",
		"pending    2",
		"           00038_session_user_agent",
		"after up   floor stays at 0; 0.1.0 and later can start",
	} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("missing %q in:\n%s", want, out.String())
		}
	}
	if planExit(pending) != 2 {
		t.Errorf("pending: exit %d, want 2", planExit(pending))
	}

	out.Reset()
	writePlan(&out, pending, false)
	if strings.Contains(out.String(), "after up") {
		t.Errorf("status should not say what up means:\n%s", out.String())
	}

	contract := db.Plan{Applied: 40, Newest: 45, Floor: 0, FloorAfter: 37, Pending: []db.Migration{{Version: 45, Name: "drop_sessions"}}}
	out.Reset()
	writePlan(&out, contract, true)
	for _, want := range []string{
		"migration 40 (past 0.2.0)",
		"contract migration: floor rises from 0 to 37; 0.2.0 and later can start",
	} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("missing %q in:\n%s", want, out.String())
		}
	}

	refused := db.Plan{Applied: 999, Newest: 42, Floor: 999, FloorAfter: 999, Ahead: []int64{999}}
	out.Reset()
	writePlan(&out, refused, true)
	for _, want := range []string{"ahead      999 applied by a newer release", "refused    database was changed by a newer Stoop"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("missing %q in:\n%s", want, out.String())
		}
	}
	if planExit(refused) != 3 {
		t.Errorf("refused: exit %d, want 3", planExit(refused))
	}

	if planExit(db.Plan{Applied: 42, Newest: 42}) != 0 {
		t.Error("up to date should exit 0")
	}
}

func TestRunMigrateUsage(t *testing.T) {
	var out bytes.Buffer
	if code := runMigrate(t.Context(), nil, &out); code != 2 || !strings.Contains(out.String(), "usage: stoop migrate") {
		t.Errorf("no args: exit %d, %q", code, out.String())
	}
}
