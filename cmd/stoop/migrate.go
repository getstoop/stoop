package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/getstoop/stoop/internal/buildinfo"
	"github.com/getstoop/stoop/internal/db"
)

const migrateUsage = `usage: stoop migrate <command> [--json]

  status   what the database has, what this binary carries, what is pending
  plan     status, plus what up would mean for rolling back; exits 2 when
           there is something to run and 3 when this binary is too old
           for the database
  up       apply the pending migrations and exit; the step the server
           runs at startup

Talks to the database in STOOP_DATABASE_URL directly. status and plan
change nothing, and are meant to be run from the release you are about to
upgrade to, before starting it; --json is what stoop upgrade reads.
docs/self-hosting/install.md → Upgrading.
`

// runMigrate implements `stoop migrate ...`. It returns the process exit code.
func runMigrate(ctx context.Context, args []string, console streams) int {
	asJSON := false
	var rest []string
	for _, arg := range args {
		if arg == "--json" {
			asJSON = true
		} else {
			rest = append(rest, arg)
		}
	}
	if len(rest) != 1 || rest[0] == "-h" || rest[0] == "--help" {
		_, _ = fmt.Fprint(console.out, migrateUsage)
		return 2
	}
	switch rest[0] {
	case "status", "plan", "up":
	default:
		return console.failf(2, "unknown migrate command %q\n\n%s", rest[0], migrateUsage)
	}
	_, pool, plan, err := openDatabase(ctx)
	if err != nil {
		return console.fail(1, err)
	}
	defer pool.Close()
	report := plan.Report(buildinfo.Version)
	switch rest[0] {
	case "status":
		writeReport(console.out, report, false, asJSON)
		return 0
	case "plan":
		writeReport(console.out, report, true, asJSON)
		return planExit(plan)
	}
	if err := plan.Refused(); err != nil {
		return console.fail(3, err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		return console.fail(1, err)
	}
	if len(plan.Pending) == 0 {
		_, _ = fmt.Fprintf(console.out, "nothing to run; database at migration %d\n", plan.Applied)
	} else {
		_, _ = fmt.Fprintf(console.out, "applied %d migrations; database at migration %d\n", len(plan.Pending), plan.Newest)
	}
	return 0
}

func writeReport(out io.Writer, report db.Report, after, asJSON bool) {
	if !asJSON {
		db.WriteReport(out, report, after)
		return
	}
	body, err := json.Marshal(report)
	if err != nil {
		panic(err)
	}
	_, _ = fmt.Fprintln(out, string(body))
}

// planExit is plan's exit code: 0 nothing to run, 2 pending, 3 refused.
func planExit(plan db.Plan) int {
	switch {
	case plan.Refused() != nil:
		return 3
	case len(plan.Pending) > 0:
		return 2
	}
	return 0
}
