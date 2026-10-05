package main

import (
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
	console, _, errOut := bufferedStreams()
	if code := runAdmin(t.Context(), []string{"list"}, console); code != 3 {
		t.Fatalf("list on an empty database: exit %d, want 3", code)
	}
	if !strings.HasPrefix(errOut.String(), "database is at migration 0 and this binary needs ") {
		t.Errorf("refusal: %q", errOut.String())
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
	run := func(args ...string) (int, string, string) {
		console, out, errOut := bufferedStreams()
		code := runAdmin(t.Context(), args, console)
		return code, out.String(), errOut.String()
	}

	if code, out, _ := run("setting", "list"); code != 0 || !strings.Contains(out, "https://env.example.com") {
		t.Errorf("list: exit %d\n%s", code, out)
	}
	if code, out, _ := run("setting", "set", "tailscale.enabled=true", "tailscale.hostname=porch"); code != 0 || !strings.Contains(out, "restart") {
		t.Errorf("set tailscale: exit %d\n%s", code, out)
	}
	if code, _, errOut := run("setting", "set", "public-url"); code != 2 || errOut != "\"public-url\" is not name=value\n" {
		t.Errorf("set without =: exit %d, want 2, %q", code, errOut)
	}
	if code, _, errOut := run("setting", "set", "public-url=chat.example.com"); code != 1 || errOut == "" {
		t.Errorf("set a bare host: exit %d, want 1, %q", code, errOut)
	}
	if code, out, _ := run("setting", "clear", "public-url"); code != 0 || out != "saved\n" {
		t.Errorf("clear: exit %d\n%s", code, out)
	}
	if code, _, errOut := run("setting", "clear"); code != 2 || errOut != "usage: stoop admin setting clear <group>\n" {
		t.Errorf("clear without a group: exit %d, %q", code, errOut)
	}
	if code, out, _ := run("setting", "reset", "public-url"); code != 0 || !strings.Contains(out, "restart it if .env has changed") {
		t.Errorf("reset: exit %d\n%s", code, out)
	}
	if code, out, _ := run("setting", "reset", "tailscale"); code != 0 || !strings.Contains(out, "restart the server for the tailscale change") {
		t.Errorf("reset tailscale: exit %d\n%s", code, out)
	}
	if code, _, errOut := run("setting", "bogus"); code != 2 || errOut != "unknown setting command \"bogus\"\n\n"+settingUsage {
		t.Errorf("unknown command: exit %d, want 2, %q", code, errOut)
	}
	if code, out, errOut := run("promote"); code != 2 || out != "" || errOut != "usage: stoop admin promote <username>\n" {
		t.Errorf("promote without a username: exit %d, out %q, err %q", code, out, errOut)
	}
	if code, _, errOut := run("password-login", "everyone", "admins"); code != 2 || errOut != "usage: stoop admin password-login <everyone|admins|off>\n" {
		t.Errorf("password-login with two values: exit %d, %q", code, errOut)
	}
}
