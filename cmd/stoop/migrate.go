package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/getstoop/stoop/internal/buildinfo"
	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/db"
)

const migrateUsage = `usage: stoop migrate <command>

  status   what the database has, what this binary carries, what is pending
  plan     status, plus what up would mean for rolling back; exits 2 when
           there is something to run and 3 when this binary is too old
           for the database
  up       apply the pending migrations and exit; the step the server
           runs at startup

Talks to the database in STOOP_DATABASE_URL directly. status and plan
change nothing, and are meant to be run from the release you are about to
upgrade to, before starting it: docs/self-hosting.md → Upgrading.
`

// runMigrate implements `stoop migrate ...`. It returns the process exit code.
func runMigrate(ctx context.Context, args []string, out io.Writer) int {
	if len(args) != 1 || args[0] == "-h" || args[0] == "--help" {
		_, _ = fmt.Fprint(out, migrateUsage)
		return 2
	}
	switch args[0] {
	case "status", "plan", "up":
	default:
		fmt.Fprintf(os.Stderr, "unknown migrate command %q\n\n%s", args[0], migrateUsage)
		return 2
	}
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "invalid configuration:", err)
		return 1
	}
	pool, err := db.Connect(ctx, cfg.DatabaseURL, cfg.DatabasePoolMax)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer pool.Close()
	plan, err := db.Inspect(ctx, pool)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	switch args[0] {
	case "status":
		writePlan(out, plan, false)
		return 0
	case "plan":
		writePlan(out, plan, true)
		return planExit(plan)
	}
	if err := plan.Refused(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 3
	}
	if err := db.Migrate(ctx, pool); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if len(plan.Pending) == 0 {
		_, _ = fmt.Fprintf(out, "nothing to run; database at migration %d\n", plan.Applied)
	} else {
		_, _ = fmt.Fprintf(out, "applied %d migrations; database at migration %d\n", len(plan.Pending), plan.Newest)
	}
	return 0
}

// planExit is plan's exit code: 0 nothing to run, 2 pending, 3 refused.
func planExit(p db.Plan) int {
	switch {
	case p.Refused() != nil:
		return 3
	case len(p.Pending) > 0:
		return 2
	}
	return 0
}

// writePlan prints what the database has and what this binary would do to
// it. With after, it also says what that means for rolling back.
func writePlan(w io.Writer, p db.Plan, after bool) {
	_, _ = fmt.Fprintf(w, "database   migration %d%s, floor %d\n", p.Applied, releaseAt(p.Applied), p.Floor)
	_, _ = fmt.Fprintf(w, "binary     %s, migration %d, floor %d\n", strings.TrimPrefix(buildinfo.Version, "v"), p.Newest, db.Floor)
	if len(p.Ahead) > 0 {
		_, _ = fmt.Fprintf(w, "ahead      %s applied by a newer release; unknown to this binary\n", versions(p.Ahead))
	}
	_, _ = fmt.Fprintf(w, "pending    %d\n", len(p.Pending))
	for _, m := range p.Pending {
		_, _ = fmt.Fprintf(w, "           %05d_%s\n", m.Version, m.Name)
	}
	if err := p.Refused(); err != nil {
		_, _ = fmt.Fprintf(w, "refused    %s\n", err)
		return
	}
	_, _ = fmt.Fprintf(w, "startable  %s\n", startable(p.Floor))
	if !after || len(p.Pending) == 0 {
		return
	}
	line := fmt.Sprintf("floor stays at %d", p.Floor)
	if p.Contract() {
		line = fmt.Sprintf("contract migration: floor rises from %d to %d", p.Floor, p.FloorAfter)
	}
	_, _ = fmt.Fprintf(w, "after up   %s; %s\n", line, startable(p.FloorAfter))
}

// startable names the releases that can start against a database with
// this floor; the upgrade script reads the version off the front.
func startable(floor int64) string {
	if r, ok := db.OldestStartable(floor); ok {
		return r.Version + " and later can start against the database"
	}
	return "no tagged release can start against the database"
}

// releaseAt names the release a migration number belongs to: " (0.2.0)"
// exactly, " (past 0.2.0)" between releases, "" before the first.
func releaseAt(applied int64) string {
	var newest db.Release
	for _, r := range db.Releases {
		if r.Migration == applied {
			return " (" + r.Version + ")"
		}
		if r.Migration < applied {
			newest = r
		}
	}
	if newest.Version == "" {
		return ""
	}
	return " (past " + newest.Version + ")"
}

func versions(vs []int64) string {
	parts := make([]string, len(vs))
	for i, v := range vs {
		parts[i] = fmt.Sprint(v)
	}
	return strings.Join(parts, ", ")
}
